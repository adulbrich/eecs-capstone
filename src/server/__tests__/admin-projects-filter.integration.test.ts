import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programs, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
  softDeleteProjectAs,
} from "#/server/_internal/projects";
import {
  getProjectAs,
  listAdminProjectsAs,
} from "#/server/_internal/projects-queries";

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

async function makeProgram(courseId: string) {
  const [row] = await db
    .insert(programs)
    .values({ courseId, courseName: "Capstone" })
    .returning();
  return row.id;
}

function baseProject(title: string, programId: string | null) {
  return {
    title,
    description: null,
    problemStatement: null,
    objectives: null,
    minQualifications: null,
    prefQualifications: null,
    url: "",
    contactEmail: "",
    contactName: null,
    imageUrl: "",
    licenseRestrictions: null,
    programId,
    notes: null,
  };
}

describe("admin projects program filter", () => {
  it("returns only projects in the selected program", async () => {
    const admin = await makeAdmin(`a-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");
    const ece441 = await makeProgram("ECE 441");

    await createProjectAs(admin, baseProject("In CS 461", cs461));
    await createProjectAs(admin, baseProject("In ECE 441", ece441));

    const { rows } = await listAdminProjectsAs(admin, {
      status: "all",
      includeSoftDeleted: false,
      program: cs461,
    });

    expect(rows.map((r) => r.title)).toEqual(["In CS 461"]);
  });

  it("includes projects with no program when no program is selected", async () => {
    const admin = await makeAdmin(`b-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");

    await createProjectAs(admin, baseProject("In CS 461", cs461));
    await createProjectAs(admin, baseProject("No program", null));

    const { rows } = await listAdminProjectsAs(admin, {
      status: "all",
      includeSoftDeleted: false,
      program: null,
    });

    expect(rows.map((r) => r.title).sort()).toEqual([
      "In CS 461",
      "No program",
    ]);
  });

  it("composes the program filter with the status filter", async () => {
    const admin = await makeAdmin(`c-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");
    const ece441 = await makeProgram("ECE 441");

    const draft = await createProjectAs(admin, baseProject("Draft", cs461));
    const live = await createProjectAs(admin, baseProject("Live", cs461));
    await performTransitionAs(admin, live.id, "submitted");
    await performTransitionAs(admin, live.id, "approved");
    await performTransitionAs(admin, live.id, "published");

    const otherProgram = await createProjectAs(
      admin,
      baseProject("Live elsewhere", ece441)
    );
    await performTransitionAs(admin, otherProgram.id, "submitted");
    await performTransitionAs(admin, otherProgram.id, "approved");
    await performTransitionAs(admin, otherProgram.id, "published");

    const { rows } = await listAdminProjectsAs(admin, {
      status: "published",
      includeSoftDeleted: false,
      program: cs461,
    });

    expect(rows.map((r) => r.title)).toEqual(["Live"]);
    expect(rows.map((r) => r.id)).not.toContain(draft.id);
    expect(rows.map((r) => r.id)).not.toContain(otherProgram.id);
  });

  it("composes the program filter with soft-delete visibility", async () => {
    const admin = await makeAdmin(`e-${Date.now()}@x.com`);
    const cs461 = await makeProgram("CS 461");

    const deleted = await createProjectAs(
      admin,
      baseProject("Soft-deleted", cs461)
    );
    await performTransitionAs(admin, deleted.id, "submitted");
    await softDeleteProjectAs(admin, deleted.id);

    const withoutDeleted = await listAdminProjectsAs(admin, {
      status: "all",
      includeSoftDeleted: false,
      program: cs461,
    });
    expect(withoutDeleted.rows.map((r) => r.id)).not.toContain(deleted.id);

    const withDeleted = await listAdminProjectsAs(admin, {
      status: "all",
      includeSoftDeleted: true,
      program: cs461,
    });
    expect(withDeleted.rows.map((r) => r.id)).toContain(deleted.id);
  });

  it("still refuses non-staff viewers", async () => {
    await auth.api.signUpEmail({
      body: { email: "plain@x.com", password: "Password1!", name: "plain" },
    });
    const [u] = await db
      .select()
      .from(user)
      .where(eq(user.email, "plain@x.com"));

    await expect(
      listAdminProjectsAs(
        { id: u.id, role: u.role },
        { status: "all", includeSoftDeleted: false, program: null }
      )
    ).rejects.toThrow("Forbidden");
  });
});

describe("getProjectAs", () => {
  it("never returns the embedding vector, even to a staff viewer after the project has been embedded", async () => {
    const admin = await makeAdmin(`staff-getproject-${Date.now()}@x.com`);
    const { id } = await createProjectAs(
      admin,
      baseProject("Embedded project", null)
    );
    await performTransitionAs(admin, id, "submitted");
    await performTransitionAs(admin, id, "approved");
    await performTransitionAs(admin, id, "published");

    await db
      .update(projects)
      .set({
        embedding: VECTOR,
        embeddingSourceHash: "test-hash",
        embeddingUpdatedAt: new Date(),
      })
      .where(eq(projects.id, id));

    const { project } = await getProjectAs(admin, { id });
    expect(project).not.toBeNull();
    expect(project?.embedding).toBeFalsy();
    expect(project?.embeddingSourceHash).toBeFalsy();
    expect(project?.embeddingUpdatedAt).toBeFalsy();
  });
});
