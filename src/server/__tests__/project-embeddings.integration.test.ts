import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { programs, projectPrograms, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { refreshProjectEmbedding } from "#/server/_internal/project-embeddings";
import { settleProjectRefreshes } from "#/server/_internal/project-refresh";
import {
  createProjectAs,
  forceTransitionAs,
  performTransitionAs,
  updateProjectAs,
  updateProjectProgramsAs,
} from "#/server/_internal/projects";

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

async function makeAdmin(email: string) {
  await auth.api.createUser({
    body: { email, name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

function baseProject(title: string) {
  return {
    title,
    description: "A rover that streams sensor data.",
    problemStatement: null,
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null,
    imageUrl: "",
    licenseRestrictions: null,
    notes: null,
  };
}

async function publish(admin: { id: string; role: string | null }, id: string) {
  await performTransitionAs(admin, id, "submitted");
  await performTransitionAs(admin, id, "approved");
  await performTransitionAs(admin, id, "published");
  await settleProjectRefreshes();
}

async function readRow(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  return row;
}

describe("refreshProjectEmbedding", () => {
  it("skips a draft without calling Bedrock", async () => {
    const admin = await makeAdmin(`a-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Draft"));
    const embed = vi.fn();

    expect(await refreshProjectEmbedding(id, embed)).toBe("skipped");
    expect(embed).not.toHaveBeenCalled();
    expect((await readRow(id)).embedding).toBeNull();
  });

  it("embeds a published project and records the hash and timestamp", async () => {
    const admin = await makeAdmin(`b-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    await publish(admin, id);
    const embed = vi.fn().mockResolvedValue(VECTOR);

    expect(await refreshProjectEmbedding(id, embed)).toBe("updated");
    expect(embed).toHaveBeenCalledTimes(1);
    expect(embed.mock.calls[0][0]).toContain("streams sensor data");

    const row = await readRow(id);
    expect(row.embedding?.length).toBe(1024);
    expect(row.embeddingSourceHash).toBeTruthy();
    expect(row.embeddingUpdatedAt).toBeTruthy();
  });

  it("is a no-op when the source has not changed", async () => {
    const admin = await makeAdmin(`c-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    await publish(admin, id);
    const embed = vi.fn().mockResolvedValue(VECTOR);

    await refreshProjectEmbedding(id, embed);
    expect(await refreshProjectEmbedding(id, embed)).toBe("unchanged");
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("re-embeds when the indexed text changes", async () => {
    const admin = await makeAdmin(`d-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    await publish(admin, id);
    const embed = vi.fn().mockResolvedValue(VECTOR);
    await refreshProjectEmbedding(id, embed);

    await db
      .update(projects)
      .set({ description: "Now about greenhouses instead." })
      .where(eq(projects.id, id));

    expect(await refreshProjectEmbedding(id, embed)).toBe("updated");
    expect(embed).toHaveBeenCalledTimes(2);
  });

  it("reports failure without throwing when Bedrock errors", async () => {
    const admin = await makeAdmin(`e-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    await publish(admin, id);
    const embed = vi.fn().mockRejectedValue(new Error("throttled"));

    expect(await refreshProjectEmbedding(id, embed)).toBe("failed");
    expect((await readRow(id)).embedding).toBeNull();
  });

  /**
   * A current hash beside a null vector is an interrupted write, and the one
   * state that would otherwise be unreachable: every reader that trusts the
   * hash alone treats the row as up to date and never embeds it. The app and
   * both sweepers test the vector as well as the hash, for this row.
   */
  it("re-embeds a row whose hash is current but whose vector is gone", async () => {
    const admin = await makeAdmin(`nv-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    await publish(admin, id);
    const embed = vi.fn().mockResolvedValue(VECTOR);
    await refreshProjectEmbedding(id, embed);
    await db
      .update(projects)
      .set({ embedding: null })
      .where(eq(projects.id, id));
    embed.mockClear();

    expect(await refreshProjectEmbedding(id, embed)).toBe("updated");
    expect(embed).toHaveBeenCalledTimes(1);
    expect((await readRow(id)).embedding?.length).toBe(1024);
  });

  /**
   * The case the whole of #427 exists for: the 547 legacy rows were written
   * straight to `archived` by `scripts/import-legacy.mjs`, never passing
   * through `published`, so this is set directly rather than transitioned.
   */
  it("embeds an archived project that has no vector", async () => {
    const admin = await makeAdmin(`arch-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Imported"));
    await db
      .update(projects)
      .set({ status: "archived" })
      .where(eq(projects.id, id));
    const embed = vi.fn().mockResolvedValue(VECTOR);

    expect(await refreshProjectEmbedding(id, embed)).toBe("updated");
    expect((await readRow(id)).embedding?.length).toBe(1024);
  });

  /**
   * Every status `isEmbeddableStatus` leaves out, not only `draft`. Set
   * directly: reaching `changes_requested` through the workflow needs a
   * comment and three transitions, and what is under test is the guard.
   */
  it.each(["submitted", "approved", "changes_requested"] as const)(
    "skips a %s project",
    async (status) => {
      const admin = await makeAdmin(`${status}-${Date.now()}@x.com`);
      const { id } = await createProjectAs(admin, baseProject("Pending"));
      await db.update(projects).set({ status }).where(eq(projects.id, id));
      const embed = vi.fn();

      expect(await refreshProjectEmbedding(id, embed)).toBe("skipped");
      expect(embed).not.toHaveBeenCalled();
      expect((await readRow(id)).embedding).toBeNull();
    }
  );

  it("skips a soft-deleted archived project", async () => {
    const admin = await makeAdmin(`da-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Imported"));
    await db
      .update(projects)
      .set({ status: "archived", deletedAt: new Date() })
      .where(eq(projects.id, id));
    const embed = vi.fn();

    expect(await refreshProjectEmbedding(id, embed)).toBe("skipped");
    expect(embed).not.toHaveBeenCalled();
  });

  it("skips a soft-deleted project", async () => {
    const admin = await makeAdmin(`f-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    await publish(admin, id);
    await db
      .update(projects)
      .set({ deletedAt: new Date() })
      .where(eq(projects.id, id));
    const embed = vi.fn();

    expect(await refreshProjectEmbedding(id, embed)).toBe("skipped");
    expect(embed).not.toHaveBeenCalled();
  });
});

describe("embedding triggers", () => {
  it("embeds when a project is published", async () => {
    const admin = await makeAdmin(`g-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    const embed = vi.fn().mockResolvedValue(VECTOR);

    await performTransitionAs(admin, id, "submitted", undefined, { embed });
    await settleProjectRefreshes();
    expect(embed).not.toHaveBeenCalled();

    await performTransitionAs(admin, id, "approved", undefined, { embed });
    await performTransitionAs(admin, id, "published", undefined, { embed });
    await settleProjectRefreshes();

    expect(embed).toHaveBeenCalledTimes(1);
    expect((await readRow(id)).embedding?.length).toBe(1024);
  });

  it("embeds when the force path publishes", async () => {
    const admin = await makeAdmin(`fg-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Forced"));
    const embed = vi.fn().mockResolvedValue(VECTOR);

    await forceTransitionAs(admin, id, "published", undefined, {
      embed,
      sendEmail: false,
    });
    await settleProjectRefreshes();

    expect(embed).toHaveBeenCalledTimes(1);
    expect((await readRow(id)).embedding?.length).toBe(1024);
  });

  it("still publishes when embedding fails", async () => {
    const admin = await makeAdmin(`h-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    const embed = vi.fn().mockRejectedValue(new Error("bedrock down"));

    await performTransitionAs(admin, id, "submitted", undefined, { embed });
    await performTransitionAs(admin, id, "approved", undefined, { embed });
    await expect(
      performTransitionAs(admin, id, "published", undefined, { embed })
    ).resolves.toMatchObject({ status: "published" });
    await settleProjectRefreshes();

    const row = await readRow(id);
    expect(row.status).toBe("published");
    expect(row.embedding).toBeNull();
  });

  it("re-embeds when a published project's indexed text is edited", async () => {
    const admin = await makeAdmin(`i-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    const embed = vi.fn().mockResolvedValue(VECTOR);
    await publish(admin, id);
    await refreshProjectEmbedding(id, embed);
    embed.mockClear();

    await updateProjectAs(
      admin,
      { ...baseProject("Live"), id, description: "Greenhouses now." },
      embed
    );
    await settleProjectRefreshes();

    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("does not embed when a draft is edited", async () => {
    const admin = await makeAdmin(`j-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Draft"));
    const embed = vi.fn().mockResolvedValue(VECTOR);

    await updateProjectAs(
      admin,
      { ...baseProject("Draft"), id, description: "Changed." },
      embed
    );
    await settleProjectRefreshes();

    expect(embed).not.toHaveBeenCalled();
  });

  it("leaves the vector in place when a published project is archived", async () => {
    const admin = await makeAdmin(`ar-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    const embed = vi.fn().mockResolvedValue(VECTOR);
    await publish(admin, id);
    await refreshProjectEmbedding(id, embed);
    const before = await readRow(id);
    embed.mockClear();

    await performTransitionAs(admin, id, "archived", undefined, { embed });
    await settleProjectRefreshes();

    // The refresh runs and finds the hash still matches, so it returns
    // "unchanged" and writes nothing. Archiving never clears a vector.
    expect(embed).not.toHaveBeenCalled();
    const after = await readRow(id);
    expect(after.status).toBe("archived");
    expect(after.embeddingSourceHash).toBe(before.embeddingSourceHash);
    expect(after.embeddingUpdatedAt).toEqual(before.embeddingUpdatedAt);
  });

  it("re-embeds when an archived project's indexed text is edited", async () => {
    const admin = await makeAdmin(`ae-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    const embed = vi.fn().mockResolvedValue(VECTOR);
    await publish(admin, id);
    await refreshProjectEmbedding(id, embed);
    await performTransitionAs(admin, id, "archived", undefined, { embed });
    await settleProjectRefreshes();
    embed.mockClear();

    await updateProjectAs(
      admin,
      { ...baseProject("Live"), id, description: "Greenhouses now." },
      embed
    );
    await settleProjectRefreshes();

    expect(embed).toHaveBeenCalledTimes(1);
  });

  it("does not embed when an archived project's untracked fields change", async () => {
    const admin = await makeAdmin(`au-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    const embed = vi.fn().mockResolvedValue(VECTOR);
    await publish(admin, id);
    await refreshProjectEmbedding(id, embed);
    await performTransitionAs(admin, id, "archived", undefined, { embed });
    await settleProjectRefreshes();
    embed.mockClear();

    await updateProjectAs(
      admin,
      { ...baseProject("Live"), id, notes: "internal only" },
      embed
    );
    await settleProjectRefreshes();

    expect(embed).not.toHaveBeenCalled();
  });

  it("does not embed when only untracked fields change", async () => {
    const admin = await makeAdmin(`k-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    const embed = vi.fn().mockResolvedValue(VECTOR);
    await publish(admin, id);
    await refreshProjectEmbedding(id, embed);
    embed.mockClear();

    await updateProjectAs(
      admin,
      { ...baseProject("Live"), id, notes: "internal only" },
      embed
    );
    await settleProjectRefreshes();

    expect(embed).not.toHaveBeenCalled();
  });

  /**
   * The headline consequence of [ADR-0025](../../../docs/adr/0025-the-embedded-text-is-prose-only.md),
   * on the writer path rather than only in the pure builder's unit test. A
   * program is a column on `projects`, and attaching one used to change the
   * embedded text and now does not.
   *
   * Asserted on the stored hash rather than on a spy. It was a spy when the
   * attach went through `updateProjectAs`, which takes an `embed` and gates a
   * call on the diff; #450 moved the attach to `updateProjectProgramsAs`,
   * which takes no `embed` at all, so "no call" became true by construction.
   * The hash is what still knows whether the text moved, and the paid
   * re-embed a moved hash would cause is the cost this decision was weighed
   * against.
   */
  it("leaves the embedded text alone when a program is attached", async () => {
    const admin = await makeAdmin(`pg-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    const embed = vi.fn().mockResolvedValue(VECTOR);
    await publish(admin, id);
    await refreshProjectEmbedding(id, embed);
    // The precondition, asserted rather than assumed: without a first vector
    // there is no hash to compare against and the rest proves nothing.
    expect(embed).toHaveBeenCalledTimes(1);
    const before = await readRow(id);
    expect(before.embeddingSourceHash).toBeTruthy();
    embed.mockClear();

    const [program] = await db
      .insert(programs)
      .values({ courseId: `CS46X-${Date.now()}`, courseName: "Capstone" })
      .returning();
    // Through the staff writer, because #450 took `programId` off
    // `ProjectInput`, so `updateProjectAs` cannot attach a program any more.
    await updateProjectProgramsAs(admin, {
      id,
      programIds: [program.id],
      acceptingApplicants: true,
      teamsSupported: 1,
    });

    // Then recompute. Asserting that the writer did not call `embed` would
    // prove nothing: it takes no embed parameter, so that holds whatever the
    // source text contains. Running the refresh again and finding the hash
    // unmoved is what actually pins the program outside the embedded text.
    await refreshProjectEmbedding(id, embed);
    const after = await readRow(id);
    const links = await db
      .select({ programId: projectPrograms.programId })
      .from(projectPrograms)
      .where(eq(projectPrograms.projectId, id));
    expect(links.map((l) => l.programId)).toEqual([program.id]);
    expect(after.embeddingSourceHash).toBe(before.embeddingSourceHash);
    expect(embed).not.toHaveBeenCalled();
  });
});
