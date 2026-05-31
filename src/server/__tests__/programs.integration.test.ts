import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { programInstructors, projects, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  addProgramInstructorAs,
  createProgramAs,
  deleteProgramAs,
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
