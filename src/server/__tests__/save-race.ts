import { eq, sql } from "drizzle-orm";
import { db } from "#/db";
import { projectCategories } from "#/db/schema";
import { lockProjectCategories } from "#/server/_internal/project-category-lock";
import { deferred } from "#/test/shared/deferred";

/**
 * A staff Save running beside another writer of the project's category links,
 * for the integration tests of that writer's lock order.
 *
 * `setProjectCategoriesAs`'s statements are copied rather than called, since
 * the function cannot be held open: the project lock, the delete of the whole
 * set, then the insert of the new one, held between the two until the writer
 * is waiting on the Save. Returns the writer's promise, so a deadlock that
 * aborts either side fails the caller's await.
 */
export async function saveBeside<T>(
  projectId: string,
  newSet: string[],
  writer: () => Promise<T>
): Promise<T> {
  const savePidOnceDeleted = deferred<number>();
  const gate = deferred<void>();
  const save = db.transaction(async (tx) => {
    const result = await tx.execute(sql`select pg_backend_pid() as pid`);
    const [{ pid }] = result.rows as { pid: number }[];
    await lockProjectCategories(tx, projectId);
    await tx
      .delete(projectCategories)
      .where(eq(projectCategories.projectId, projectId));
    savePidOnceDeleted.resolve(pid);
    await gate.promise;
    await tx
      .insert(projectCategories)
      .values(newSet.map((categoryId) => ({ projectId, categoryId })));
  });
  const savePid = await savePidOnceDeleted.promise;
  const running = writer();
  // Observed by the awaiter below; this only keeps a rejection that lands
  // while the Save is pending from being reported as unhandled.
  running.catch(() => undefined);
  try {
    await untilABackendWaitsOn(savePid);
  } finally {
    // Even on a timeout, so the Save's transaction does not stay open and
    // block the next test's truncate.
    gate.resolve();
    await save;
  }
  return running;
}

/**
 * Polls until some backend is blocked by the Save's, which is the writer
 * beside it: with the project lock it waits on the Save's project row,
 * without it on the link row the Save deleted. Asked of the Save's own pid
 * rather than of every lock wait on the database, so a dev server's lock waits
 * cannot end the poll early; another integration run's truncate, queued
 * behind the Save, still could. Fails rather than going on, so the Save
 * cannot commit first and pass the test for nothing, and gives up after about
 * two seconds, inside Vitest's own five-second timeout, so this error is the
 * one reported.
 */
async function untilABackendWaitsOn(savePid: number) {
  for (let i = 0; i < 100; i++) {
    const result = await db.execute(
      sql`select count(*)::int as n from pg_stat_activity where ${savePid}::int = any(pg_blocking_pids(pid))`
    );
    const [row] = result.rows as { n: number }[];
    if (row && row.n > 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("The writer beside the Save never waited on it.");
}
