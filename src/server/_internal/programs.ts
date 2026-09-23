import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  PROGRAM_COURSE_ID_INDEX,
  programInstructors,
  programs,
  projectPrograms,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { createReferenceListCache } from "#/lib/_internal/reference-list-cache";
import { assertStaff, isStaff, STAFF_ROLES } from "#/lib/viewer";
import type { ProgramInput, ProgramUpdateInput } from "../programs";
import { findUniqueViolation } from "./pg-errors";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

/**
 * The public program list, projected by name.
 *
 * Reachable without a session, because the project listing's program filter
 * reads it. `term_count` is staff-only and left out here; naming the columns
 * is what stops the next staff-only column riding a public read, and
 * `programs.integration.test.ts` pins the key set.
 */
export function listProgramsImpl() {
  return programLists.get("", loadPrograms);
}

async function loadPrograms() {
  const rows = await db
    .select({
      id: programs.id,
      courseId: programs.courseId,
      courseName: programs.courseName,
      description: programs.description,
      createdAt: programs.createdAt,
      updatedAt: programs.updatedAt,
    })
    .from(programs)
    .orderBy(programs.courseId);
  return { rows };
}

/**
 * Cached per task (#558, ADR-0048). The three program writers clear it; an
 * instructor change does not, because the public list carries no instructors.
 */
const programLists =
  createReferenceListCache<Awaited<ReturnType<typeof loadPrograms>>>();

/**
 * Every program with the names of who teaches it, for the admin index.
 *
 * A separate read from `listProgramsImpl` rather than a widening of it: that
 * one is public, feeds the project listing's program filter without a
 * session, and is pinned to the six `programs` columns. This one joins
 * `user`, and a read that reaches a column of somebody's account is
 * staff-only. Names only: the detail read already hands out addresses, and a
 * table listing people needs nothing more.
 *
 * Two queries grouped in JS rather than one `array_agg` through Drizzle: at
 * capstone scale the clear query costs nothing, and a hand-written aggregate
 * is one more thing to read. Membership is a directory listing and grants
 * nothing; see #92.
 */
export async function listProgramsWithInstructorsAs(viewer: AuthUser) {
  assertStaff(viewer);
  const [{ rows }, links] = await Promise.all([
    listProgramsImpl(),
    db
      .select({ programId: programInstructors.programId, name: user.name })
      .from(programInstructors)
      .innerJoin(user, eq(programInstructors.userId, user.id))
      .orderBy(user.name),
  ]);
  const namesByProgram = new Map<string, string[]>();
  for (const link of links) {
    const names = namesByProgram.get(link.programId) ?? [];
    names.push(link.name);
    namesByProgram.set(link.programId, names);
  }
  return {
    rows: rows.map((row) => ({
      ...row,
      instructorNames: namesByProgram.get(row.id) ?? [],
    })),
  };
}

export async function listProgramsWithInstructorsForCurrentUser() {
  const viewer = await requireUser();
  return listProgramsWithInstructorsAs(viewer);
}

/**
 * A program with its instructors, for staff.
 *
 * Staff-gated because of the join below: it returns each instructor's address
 * and role, which is a staff view of an account, not a property of the
 * program. The program row itself carries no personal data and stays public
 * through `listProgramsImpl`, which is what the project listing's program
 * filter reads.
 */
export async function getProgramAs(viewer: AuthUser, data: { id: string }) {
  assertStaff(viewer);
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
  // Join rows, not projects with this in a column: a project that runs in
  // this program and another counts here too (#462).
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectPrograms)
    .where(eq(projectPrograms.programId, data.id));
  return { program, instructors, projectCount: count };
}

export async function getProgramForCurrentUser(data: { id: string }) {
  const viewer = await requireUser();
  return getProgramAs(viewer, data);
}

/**
 * Turns a unique violation on the `lower(course_id)` index into the sentence
 * the staff form should show, naming the stored spelling so a staff member
 * who typed "cs46x-corvallis" sees that "CS46X-CORVALLIS" is the row they
 * collided with. Anything else is rethrown untouched. Modelled on
 * `rethrowNameCollision` in `categories.ts`.
 */
async function rethrowCourseIdCollision(
  error: unknown,
  courseId: string
): Promise<never> {
  if (!findUniqueViolation(error, PROGRAM_COURSE_ID_INDEX)) {
    throw error;
  }
  const [existing] = await db
    .select({ courseId: programs.courseId })
    .from(programs)
    .where(sql`lower(${programs.courseId}) = lower(${courseId})`);
  throw new Error(
    `A program with course ID "${existing?.courseId ?? courseId}" already exists.`
  );
}

export async function createProgramAs(viewer: AuthUser, data: ProgramInput) {
  assertStaff(viewer);
  try {
    const [row] = await db
      .insert(programs)
      .values({
        courseId: data.courseId,
        courseName: data.courseName,
        description: data.description ?? null,
        termCount: data.termCount ?? null,
        expectedTeams: data.expectedTeams ?? null,
      })
      .returning();
    programLists.clear();
    return { id: row.id };
  } catch (error) {
    return rethrowCourseIdCollision(error, data.courseId);
  }
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
  try {
    await db
      .update(programs)
      .set({
        courseId: data.courseId,
        courseName: data.courseName,
        description: data.description ?? null,
        termCount: data.termCount ?? null,
        expectedTeams: data.expectedTeams ?? null,
        updatedAt: new Date(),
      })
      .where(eq(programs.id, data.id));
    programLists.clear();
    return { id: data.id };
  } catch (error) {
    // An edit that leaves the course id alone does not reach here: the row
    // collides only with itself, and Postgres does not count that.
    return rethrowCourseIdCollision(error, data.courseId);
  }
}

export async function updateProgramForCurrentUser(data: ProgramUpdateInput) {
  const viewer = await requireUser();
  return updateProgramAs(viewer, data);
}

/**
 * Deleting a program cascades its join rows away, so a project that ran
 * only here is left unplaced and one that also runs elsewhere simply loses
 * this program (#462). The returned count is every project affected either
 * way, which is why it is not called "unlinked": for a shared project that
 * would be false.
 */
export async function deleteProgramAs(viewer: AuthUser, id: string) {
  assertStaff(viewer);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectPrograms)
    .where(eq(projectPrograms.programId, id));
  await db.delete(programs).where(eq(programs.id, id));
  programLists.clear();
  return { id, affectedProjectCount: count };
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
  if (!isStaff(target)) {
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

/**
 * Everyone who could be added to a program as an instructor.
 *
 * Staff-gated: this is the whole staff roster with addresses and roles, which
 * also answers "who are the admins" for anyone who asks. Its one consumer is
 * `instructor-manager.tsx` on the admin program pages.
 */
export async function listEligibleInstructorsAs(viewer: AuthUser) {
  assertStaff(viewer);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
    })
    .from(user)
    .where(inArray(user.role, [...STAFF_ROLES]))
    .orderBy(user.name);
  return { rows };
}

export async function listEligibleInstructorsForCurrentUser() {
  const viewer = await requireUser();
  return listEligibleInstructorsAs(viewer);
}
