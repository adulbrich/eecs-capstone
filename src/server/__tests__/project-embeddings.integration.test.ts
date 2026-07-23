import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { refreshProjectEmbedding } from "#/server/_internal/project-embeddings";
import {
  createProjectAs,
  performTransitionAs,
  updateProjectAs,
} from "#/server/_internal/projects";

const VECTOR = Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0));

async function makeAdmin(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
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
    programId: null,
    notes: null,
  };
}

async function publish(admin: { id: string; role: string | null }, id: string) {
  await performTransitionAs(admin, id, "submitted");
  await performTransitionAs(admin, id, "approved");
  await performTransitionAs(admin, id, "published");
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

    await performTransitionAs(admin, id, "submitted", undefined, embed);
    expect(embed).not.toHaveBeenCalled();

    await performTransitionAs(admin, id, "approved", undefined, embed);
    await performTransitionAs(admin, id, "published", undefined, embed);

    expect(embed).toHaveBeenCalledTimes(1);
    expect((await readRow(id)).embedding?.length).toBe(1024);
  });

  it("still publishes when embedding fails", async () => {
    const admin = await makeAdmin(`h-${Date.now()}@x.com`);
    const { id } = await createProjectAs(admin, baseProject("Live"));
    const embed = vi.fn().mockRejectedValue(new Error("bedrock down"));

    await performTransitionAs(admin, id, "submitted", undefined, embed);
    await performTransitionAs(admin, id, "approved", undefined, embed);
    await expect(
      performTransitionAs(admin, id, "published", undefined, embed)
    ).resolves.toMatchObject({ status: "published" });

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

    expect(embed).not.toHaveBeenCalled();
  });
});
