import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import {
  programInstructors,
  programs,
  projectPrograms,
  projects,
  user,
} from "#/db/schema";
import { auth } from "#/lib/auth";
import type { UserRole } from "#/lib/vocabularies";
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
import {
  createProjectAs,
  updateProjectProgramsAs,
} from "#/server/_internal/projects";

async function makeUser(email: string, role: UserRole) {
  await auth.api.createUser({
    body: { email, name: email },
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
    );
  });
});

describe("term_count and expected_teams are staff-editable and never public", () => {
  it("round-trips through create and update, and reaches only the staff detail", async () => {
    const admin = await makeUser(`tc-a-${Date.now()}@x.com`, "admin");
    const courseId = `TC-${Date.now()}`;
    const created = await createProgramAs(admin, {
      courseId,
      courseName: "Three terms",
      description: null,
      termCount: 3,
      expectedTeams: 12,
    });
    const detail = await getProgramAs(admin, { id: created.id });
    expect(detail.program.termCount).toBe(3);
    expect(detail.program.expectedTeams).toBe(12);

    // Nullable on purpose: unset must stay visibly unset, not become zero.
    await updateProgramAs(admin, {
      id: created.id,
      courseId,
      courseName: "Three terms",
      description: null,
      termCount: null,
      expectedTeams: null,
    });
    const cleared = await getProgramAs(admin, { id: created.id });
    expect(cleared.program.termCount).toBeNull();
    expect(cleared.program.expectedTeams).toBeNull();

    // The public list projects its columns by name, so the new column does
    // not ride into it; the six-key pin above is the enforcement.
    const { rows } = await listProgramsImpl();
    const row = rows.find((r) => r.id === created.id);
    expect(row).not.toHaveProperty("termCount");
    expect(row).not.toHaveProperty("expectedTeams");
  });
});

describe("programs", () => {
  it("create + update + delete; deleteProgram returns affectedProjectCount", async () => {
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
      notes: null,
    });
    // Placed by the staff writer, the only one that sets the column after
    // create since #450.
    await updateProjectProgramsAs(admin, {
      id: projId,
      programIds: [programId],
      acceptingApplicants: true,
      teamsSupported: 1,
    });

    const result = await deleteProgramAs(admin, programId);
    expect(result.affectedProjectCount).toBe(1);

    // The join row cascades away and the project survives unplaced, which
    // is the same outcome the old `on delete set null` produced for a
    // project that ran in one program (#462).
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projId));
    expect(project.id).toBe(projId);
    const links = await db
      .select()
      .from(projectPrograms)
      .where(eq(projectPrograms.projectId, projId));
    expect(links).toEqual([]);
  });

  // The count is every project that loses this program, not every project
  // left unplaced: a shared one keeps its others and is still affected.
  it("deleteProgram leaves a shared project with its other programs", async () => {
    const admin = await makeUser(`dp2-${Date.now()}@x.com`, "admin");
    const { id: doomed } = await createProgramAs(admin, {
      courseId: `DEL-${Date.now()}`,
      courseName: "Doomed",
      description: null,
      termCount: null,
      expectedTeams: null,
    });
    const { id: kept } = await createProgramAs(admin, {
      courseId: `KEEP-${Date.now()}`,
      courseName: "Kept",
      description: null,
      termCount: null,
      expectedTeams: null,
    });
    const { id: projId } = await createProjectAs(admin, {
      title: `Shared ${Date.now()}`,
      description: null,
      problemStatement: null,
      objectives: null,
      minQualifications: null,
      prefQualifications: null,
      url: null,
      contactEmail: null,
      contactName: null,
      imageUrl: "",
      licenseRestrictions: null,
      notes: null,
    });
    await updateProjectProgramsAs(admin, {
      id: projId,
      programIds: [doomed, kept],
      acceptingApplicants: true,
      teamsSupported: 1,
    });

    // The program detail page's counter reads join rows, so a project that
    // runs here and elsewhere is counted here too.
    const before = await getProgramAs(admin, { id: doomed });
    expect(before.projectCount).toBe(1);

    const result = await deleteProgramAs(admin, doomed);
    expect(result.affectedProjectCount).toBe(1);

    const links = await db
      .select({ programId: projectPrograms.programId })
      .from(projectPrograms)
      .where(eq(projectPrograms.projectId, projId));
    expect(links.map((l) => l.programId)).toEqual([kept]);
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

describe("the cached public list (#558)", () => {
  // `vitest.integration.config.ts` turns the cache on, so the first list
  // below is cached and each later one reads stale unless the write cleared it.
  it("shows a staff create, edit and delete on the task that made it", async () => {
    const admin = await makeUser(`pcache-${Date.now()}@x.com`, "admin");
    const courseIds = async () =>
      (await listProgramsImpl()).rows.map((r) => r.courseId);
    expect(await courseIds()).toEqual([]);

    const { id } = await createProgramAs(admin, {
      courseId: "CS461",
      courseName: "Capstone",
      description: null,
    });
    expect(await courseIds()).toEqual(["CS461"]);

    await updateProgramAs(admin, {
      id,
      courseId: "CS462",
      courseName: "Capstone",
      description: null,
    });
    expect(await courseIds()).toEqual(["CS462"]);

    await deleteProgramAs(admin, id);
    expect(await courseIds()).toEqual([]);
  });

  it("serves a write made behind its back from the cache, which is the trade", async () => {
    expect((await listProgramsImpl()).rows).toEqual([]);
    await db
      .insert(programs)
      .values({ courseId: "ELSEWHERE", courseName: "Elsewhere" });
    expect((await listProgramsImpl()).rows).toEqual([]);
  });
});
