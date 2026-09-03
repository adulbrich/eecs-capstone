import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programInstructors, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  addProgramInstructorAs,
  createProgramAs,
  deleteProgramAs,
  getProgramAs,
  listEligibleInstructorsAs,
  listProgramsImpl,
  listProgramsWithInstructorsAs,
  removeProgramInstructorAs,
  updateProgramAs,
} from "#/server/_internal/programs";
import { createProjectAs } from "#/server/_internal/projects";

async function makeUser(email: string, role: "user" | "admin" | "instructor") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

describe("the instructor-bearing reads are staff-only", () => {
  // Both were reachable without a session until 2026-08-28. See the QUIRKS
  // entry "A read is public or staff-only per endpoint, not per domain" for
  // why, and for the rule that replaced the classification which missed it.
  it("refuses a program detail read to a non-staff viewer", async () => {
    const admin = await makeUser(`gp-a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`gp-s-${Date.now()}@x.com`, "user");
    const { id } = await createProgramAs(admin, {
      courseId: `CS-${Date.now()}`,
      courseName: "Capstone",
      description: null,
    });

    // Only the staff gate is exercised here. `requireUser()` in the wrapper
    // is what shuts the endpoint to anonymous callers, and it reads a request
    // session, so it is not reachable from an integration test.
    await expect(getProgramAs(student, { id })).rejects.toThrow(/Forbidden/);
    await expect(getProgramAs(admin, { id })).resolves.toMatchObject({
      program: { id },
    });
  });

  it("refuses the instructor roster to a non-staff viewer", async () => {
    const admin = await makeUser(`li-a-${Date.now()}@x.com`, "admin");
    const student = await makeUser(`li-s-${Date.now()}@x.com`, "user");

    await expect(listEligibleInstructorsAs(student)).rejects.toThrow(
      /Forbidden/
    );
    const { rows } = await listEligibleInstructorsAs(admin);
    expect(rows.some((r) => r.id === admin.id)).toBe(true);
  });

  it("keeps user columns out of the public program list", async () => {
    // `listProgramsImpl` has no gate on purpose: the public project listing
    // filters by program, so it has to be reachable without a session. What
    // makes that safe is that the query never reaches `user` and projects
    // its columns by name, leaving `term_count` out; this test pins the key
    // set so neither a join nor a new column widens the public read.
    const admin = await makeUser(`lp-a-${Date.now()}@x.com`, "admin");
    const courseId = `PUB-${Date.now()}`;
    await createProgramAs(admin, {
      courseId,
      courseName: "Public",
      description: null,
    });

    const { rows } = await listProgramsImpl();
    const row = rows.find((r) => r.courseId === courseId);
    expect(row).toBeDefined();
    // Sorted, like the same assertion on the projects side: the point is the
    // key set, and pinning Drizzle's projection order would fail on a harmless
    // reordering of the schema.
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "courseId",
      "courseName",
      "createdAt",
      "description",
      "id",
      "updatedAt",
    ]);
  });
});

describe("the admin index reads instructor names through its own staff seam", () => {
  // The public list above must stay six columns, so the names the admin
  // table shows come from a separate read that joins `user` and is gated
  // like getProgram: a read is staff-only when its query reaches a column of
  // somebody's account.
  it("returns names per program, and an empty list rather than null", async () => {
    const stamp = Date.now();
    const admin = await makeUser(`li-a-${stamp}@x.com`, "admin");
    // makeUser names each account after its address.
    const teacherEmail = `li-t-${stamp}@x.com`;
    const otherEmail = `li-o-${stamp}@x.com`;
    const teacher = await makeUser(teacherEmail, "instructor");
    const other = await makeUser(otherEmail, "instructor");
    const taught = await createProgramAs(admin, {
      courseId: `LI-T-${stamp}`,
      courseName: "Taught",
      description: null,
    });
    const untaught = await createProgramAs(admin, {
      courseId: `LI-U-${stamp}`,
      courseName: "Untaught",
      description: null,
    });
    await addProgramInstructorAs(admin, {
      programId: taught.id,
      userId: teacher.id,
    });
    await addProgramInstructorAs(admin, {
      programId: taught.id,
      userId: other.id,
    });

    const { rows } = await listProgramsWithInstructorsAs(admin);
    const taughtRow = rows.find((r) => r.id === taught.id);
    const untaughtRow = rows.find((r) => r.id === untaught.id);
    // Names only, in name order, so the joined string the column sorts on
    // does not depend on insertion order.
    expect(taughtRow?.instructorNames).toEqual([otherEmail, teacherEmail]);
    expect(untaughtRow?.instructorNames).toEqual([]);
    // Names and nothing else off the account: no address, no role, no id.
    expect(Object.keys(taughtRow ?? {}).sort()).toEqual([
      "courseId",
      "courseName",
      "createdAt",
      "description",
      "id",
      "instructorNames",
      "updatedAt",
    ]);
  });

  it("refuses a non-staff viewer", async () => {
    const plain = await makeUser(`li-p-${Date.now()}@x.com`, "user");
    await expect(listProgramsWithInstructorsAs(plain)).rejects.toThrow(
      /Forbidden/
describe("term_count is staff-editable and never public", () => {
  it("round-trips through create and update, and reaches only the staff detail", async () => {
    const admin = await makeUser(`tc-a-${Date.now()}@x.com`, "admin");
    const courseId = `TC-${Date.now()}`;
    const created = await createProgramAs(admin, {
      courseId,
      courseName: "Three terms",
      description: null,
      termCount: 3,
    });
    const detail = await getProgramAs(admin, { id: created.id });
    expect(detail.program.termCount).toBe(3);

    // Nullable on purpose: unset must stay visibly unset, not become zero.
    await updateProgramAs(admin, {
      id: created.id,
      courseId,
      courseName: "Three terms",
      description: null,
      termCount: null,
    });
    const cleared = await getProgramAs(admin, { id: created.id });
    expect(cleared.program.termCount).toBeNull();

    // The public list projects its columns by name, so the new column does
    // not ride into it; the six-key pin above is the enforcement.
    const { rows } = await listProgramsImpl();
    expect(rows.find((r) => r.id === created.id)).not.toHaveProperty(
      "termCount"
    );
  });
});

describe("programs", () => {
  it("create + update + delete; deleteProgram returns unlinkedProjectCount", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const { id: programId } = await createProgramAs(admin, {
      courseId: "CS-462",
      courseName: "Capstone",
      description: null,
    });

    await updateProgramAs(admin, {
      id: programId,
      courseId: "CS-462",
      courseName: "Capstone Redux",
      description: "updated",
    });

    const { id: projId } = await createProjectAs(admin, {
      title: "P",
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
    });

    const result = await deleteProgramAs(admin, programId);
    expect(result.unlinkedProjectCount).toBe(1);

    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projId));
    expect(project.programId).toBeNull();
  });

  it("addProgramInstructor refuses for plain user role", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    const plainUser = await makeUser(`u-${Date.now()}@x.com`, "user");
    const { id: programId } = await createProgramAs(admin, {
      courseId: "CS-100",
      courseName: "Intro",
      description: null,
    });
    await expect(
      addProgramInstructorAs(admin, { programId, userId: plainUser.id })
    ).rejects.toThrow();
  });

  it("add + remove instructor is idempotent", async () => {
    const admin = await makeUser(`a3-${Date.now()}@x.com`, "admin");
    const instructor = await makeUser(`i-${Date.now()}@x.com`, "instructor");
    const { id: programId } = await createProgramAs(admin, {
      courseId: "CS-200",
      courseName: "Advanced",
      description: null,
    });
    await addProgramInstructorAs(admin, {
      programId,
      userId: instructor.id,
    });
    await addProgramInstructorAs(admin, {
      programId,
      userId: instructor.id,
    });
    const rows = await db
      .select()
      .from(programInstructors)
      .where(eq(programInstructors.programId, programId));
    expect(rows.length).toBe(1);

    await removeProgramInstructorAs(admin, {
      programId,
      userId: instructor.id,
    });
    await removeProgramInstructorAs(admin, {
      programId,
      userId: instructor.id,
    });
    const after = await db
      .select()
      .from(programInstructors)
      .where(eq(programInstructors.programId, programId));
    expect(after.length).toBe(0);
  });
});
