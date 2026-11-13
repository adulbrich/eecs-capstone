import { eq, sql } from "drizzle-orm";
import { db } from "#/db";
import { projectCategories } from "#/db/schema";
import { lockProjectCategories } from "#/server/_internal/project-category-lock";

/**
 * A staff Save running beside another writer of the project's category links,
 * for the integration tests of that writer's lock order: the category cleanup
 * (#857) and `deleteCategoryAs` (#861).
 *
 * `setProjectCategoriesAs`'s statements are copied rather than called, since
 * the function cannot be held open: the project lock, the delete of the whole
 * set, then the insert of the new one, held between the two until the other
 * writer is waiting. Returns the other writer's promise, so a deadlock that
 * aborts either side fails the caller's await.
 */
export async function saveBeside<T>(
  projectId: string,
  newSet: string[],
  other: () => Promise<T>
): Promise<T> {
  let deleted!: () => void;
  const ready = new Promise<void>((resolve) => {
    deleted = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const save = db.transaction(async (tx) => {
    await lockProjectCategories(tx, projectId);
    await tx
      .delete(projectCategories)
      .where(eq(projectCategories.projectId, projectId));
    deleted();
    await gate;
    await tx
      .insert(projectCategories)
      .values(newSet.map((categoryId) => ({ projectId, categoryId })));
  });
  await ready;
  const running = other();
  // Observed by the awaiter below; this only keeps a rejection that lands
  // while the Save is pending from being reported as unhandled.
  running.catch(() => undefined);
  try {
    await untilABackendWaitsOnALock();
  } finally {
    // Even on a timeout, so the Save's transaction does not stay open and
    // block the next test's truncate.
    release();
    await save;
  }
  return running;
}

/**
 * Polls until some backend on this database is blocked on a lock, which is
 * the writer beside the Save, since the integration files run one at a time:
 * with the project lock it waits on the Save's project row, without it on the
 * link row the Save deleted. Fails rather than going on, so the Save cannot
 * commit first and pass the test for nothing, and gives up after about two
 * seconds, inside Vitest's own five-second timeout, so this error is the one
 * reported.
 */
async function untilABackendWaitsOnALock() {
  for (let i = 0; i < 100; i++) {
    const result = await db.execute(
      sql`select count(*)::int as n from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock'`
    );
    const [row] = result.rows as { n: number }[];
    if (row && row.n > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The writer beside the Save never waited on a lock.");
}
