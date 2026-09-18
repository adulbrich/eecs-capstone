import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { PROGRAM_COURSE_ID_INDEX, programs } from "#/db/schema";
import { findUniqueViolation } from "#/server/_internal/pg-errors";
import { createProgramAs, updateProgramAs } from "#/server/_internal/programs";

/**
 * The constraint from #472, tested against the database rather than the
 * schema file, the way `categories-unique.integration.test.ts` tests its own:
 * Drizzle renders the index expression and only Postgres decides what it
 * rejects, and the case folding is a thing Postgres does rather than a thing
 * TypeScript can state.
 *
 * The writers are here too, because a 23505 reaching a staff member as a
 * stack trace is the failure this issue is actually about.
 */

const INDEX = PROGRAM_COURSE_ID_INDEX;
const STAFF = { id: "staff-fixture", role: "admin" };

function insert(courseId: string) {
  return db.insert(programs).values({ courseId, courseName: "Capstone" });
}

/**
 * Asserts the insert was refused by this index, not merely that it failed.
 * `findUniqueViolation` walks the cause chain for SQLSTATE 23505 on exactly
 * this constraint; see its doc for why matching the message is wrong.
 */
async function expectRejectedByTheIndex(pending: Promise<unknown>) {
  const thrown = await pending.then(
    () => undefined,
    (error: unknown) => error
  );
  const violation = findUniqueViolation(thrown, INDEX);
  expect({
    code: violation?.code,
    constraint: violation?.constraint,
  }).toEqual({ code: "23505", constraint: INDEX });
}

describe("the programs unique index", () => {
  it("rejects the same course id twice", async () => {
    await insert("CS46X-CORVALLIS");

    await expectRejectedByTheIndex(insert("CS46X-CORVALLIS"));
  });

  it("rejects course ids that differ only in case", async () => {
    // `cs467` and `CS467` are one course, which is the whole reason the index
    // keys on `lower()` rather than on the column.
    await insert("CS467-ECAMPUS");

    await expectRejectedByTheIndex(insert("cs467-ecampus"));
  });

  it("allows two programs that share a course name", async () => {
    // Deliberately not unique: the 30-week programs share a display name.
    await db
      .insert(programs)
      .values({ courseId: "CS46X-CORVALLIS", courseName: "Capstone (30 wk)" });

    await expect(
      db
        .insert(programs)
        .values({ courseId: "CS46X-ECAMPUS", courseName: "Capstone (30 wk)" })
    ).resolves.toBeDefined();
  });
});

describe("the program writers on a collision", () => {
  it("names the stored spelling when a create collides", async () => {
    await createProgramAs(STAFF, {
      courseId: "CS46X-CORVALLIS",
      courseName: "Capstone",
    });

    await expect(
      createProgramAs(STAFF, {
        courseId: "cs46x-corvallis",
        courseName: "Something else",
      })
    ).rejects.toThrow(
      'A program with course ID "CS46X-CORVALLIS" already exists.'
    );
  });

  it("names the stored spelling when an update collides", async () => {
    const { id: first } = await createProgramAs(STAFF, {
      courseId: "CS46X-CORVALLIS",
      courseName: "Capstone",
    });
    const { id: second } = await createProgramAs(STAFF, {
      courseId: "CS46X-ECAMPUS",
      courseName: "Capstone",
    });

    await expect(
      updateProgramAs(STAFF, {
        id: second,
        courseId: "CS46X-corvallis",
        courseName: "Capstone",
      })
    ).rejects.toThrow(
      'A program with course ID "CS46X-CORVALLIS" already exists.'
    );

    // The row it collided with is untouched, and so is the one that failed.
    const [kept] = await db
      .select()
      .from(programs)
      .where(eq(programs.id, first));
    expect(kept.courseId).toBe("CS46X-CORVALLIS");
    const [failed] = await db
      .select()
      .from(programs)
      .where(eq(programs.id, second));
    expect(failed.courseId).toBe("CS46X-ECAMPUS");
  });

  it("saves an edit that leaves the course id alone", async () => {
    // The row collides with itself under the index, so this is the case a
    // naive "does any row already hold this id" check would refuse.
    const { id } = await createProgramAs(STAFF, {
      courseId: "ECE44X-CORVALLIS",
      courseName: "Capstone",
    });

    await updateProgramAs(STAFF, {
      id,
      courseId: "ECE44X-CORVALLIS",
      courseName: "Renamed",
    });

    const [row] = await db.select().from(programs).where(eq(programs.id, id));
    expect(row.courseName).toBe("Renamed");
  });
});
