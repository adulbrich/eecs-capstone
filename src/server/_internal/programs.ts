import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "#/db";
import { programInstructors, programs, projects, user } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { isStaff } from "#/lib/project-visibility";
import type { ProgramInput, ProgramUpdateInput } from "../programs";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

function assertStaff(viewer: AuthUser) {
  if (!isStaff({ id: viewer.id, role: viewer.role ?? null })) {
    throw new Error("Forbidden");
  }
}

export async function listProgramsImpl() {
  const rows = await db.select().from(programs).orderBy(programs.courseId);
  return { rows };
}

export async function getProgramImpl(data: { id: string }) {
  const [program] = await db
    .select()
    .from(programs)
    .where(eq(programs.id, data.id));
  if (!program) {
    throw new Error("Program not found");
  }
  const instructors = await db
    .select({
      userId: programInstructors.userId,
      name: user.name,
      email: user.email,
      role: user.role,
    })
    .from(programInstructors)
    .innerJoin(user, eq(programInstructors.userId, user.id))
    .where(eq(programInstructors.programId, data.id))
    .orderBy(user.name);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.programId, data.id));
  return { program, instructors, projectCount: count };
}

export async function createProgramAs(viewer: AuthUser, data: ProgramInput) {
  assertStaff(viewer);
  const [row] = await db
    .insert(programs)
    .values({
      courseId: data.courseId,
      courseName: data.courseName,
      description: data.description ?? null,
    })
    .returning();
  return { id: row.id };
}

export async function createProgramForCurrentUser(data: ProgramInput) {
  const viewer = await requireUser();
  return createProgramAs(viewer, data);
}

export async function updateProgramAs(
  viewer: AuthUser,
  data: ProgramUpdateInput
) {
  assertStaff(viewer);
  await db
    .update(programs)
    .set({
      courseId: data.courseId,
      courseName: data.courseName,
      description: data.description ?? null,
      updatedAt: new Date(),
    })
    .where(eq(programs.id, data.id));
  return { id: data.id };
}

export async function updateProgramForCurrentUser(data: ProgramUpdateInput) {
  const viewer = await requireUser();
  return updateProgramAs(viewer, data);
}

export async function deleteProgramAs(viewer: AuthUser, id: string) {
  assertStaff(viewer);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.programId, id));
  await db.delete(programs).where(eq(programs.id, id));
  return { id, unlinkedProjectCount: count };
}

export async function deleteProgramForCurrentUser(id: string) {
  const viewer = await requireUser();
  return deleteProgramAs(viewer, id);
}

export async function addProgramInstructorAs(
  viewer: AuthUser,
  data: { programId: string; userId: string }
) {
  assertStaff(viewer);
  const [target] = await db.select().from(user).where(eq(user.id, data.userId));
  if (!target) {
    throw new Error("User not found");
  }
  if (target.role !== "admin" && target.role !== "instructor") {
    throw new Error(
      "Only users with role admin or instructor can be assigned as program instructors"
    );
  }
  await db
    .insert(programInstructors)
    .values({ programId: data.programId, userId: data.userId })
    .onConflictDoNothing();
  return { programId: data.programId, userId: data.userId };
}

export async function addProgramInstructorForCurrentUser(data: {
  programId: string;
  userId: string;
}) {
  const viewer = await requireUser();
  return addProgramInstructorAs(viewer, data);
}

export async function removeProgramInstructorAs(
  viewer: AuthUser,
  data: { programId: string; userId: string }
) {
  assertStaff(viewer);
  await db
    .delete(programInstructors)
    .where(
      and(
        eq(programInstructors.programId, data.programId),
        eq(programInstructors.userId, data.userId)
      )
    );
  return { programId: data.programId, userId: data.userId };
}

export async function removeProgramInstructorForCurrentUser(data: {
  programId: string;
  userId: string;
}) {
  const viewer = await requireUser();
  return removeProgramInstructorAs(viewer, data);
}

export async function listEligibleInstructorsImpl() {
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    })
    .from(user)
    .where(inArray(user.role, ["admin", "instructor"]))
    .orderBy(user.name);
  return { rows };
}
