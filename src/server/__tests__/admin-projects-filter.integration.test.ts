import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programs, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  createProjectAs,
  performTransitionAs,
} from "#/server/_internal/projects";
import { listAdminProjectsAs } from "#/server/_internal/projects-queries";

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

    const draft = await createProjectAs(admin, baseProject("Draft", cs461));
    const live = await createProjectAs(admin, baseProject("Live", cs461));
    await performTransitionAs(admin, live.id, "submitted");
    await performTransitionAs(admin, live.id, "approved");
    await performTransitionAs(admin, live.id, "published");

    const { rows } = await listAdminProjectsAs(admin, {
      status: "published",
      includeSoftDeleted: false,
      program: cs461,
    });

    expect(rows.map((r) => r.title)).toEqual(["Live"]);
    expect(rows.map((r) => r.id)).not.toContain(draft.id);
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
