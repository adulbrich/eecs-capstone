import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import { projectCategories } from "#/db/schema";
import { lockProjectCategories } from "#/server/_internal/project-category-lock";
import { deferred } from "#/test/shared/deferred";

/**
 * A staff Save running beside another writer of the project's category links,
 * for the integration tests of that writer's lock order.
 *
 * `setProjectCategoriesAs`'s statements are copied rather than called, since
 * the function cannot be held open: the project lock, the read of the current
 * set, the delete of the links it drops, then the insert of the ones it adds,
 * held between the two until the writer is waiting on the Save. Returns the
 * writer's promise, so a deadlock that aborts either side fails the caller's
 * await.
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
    const current = (
      await tx
        .select({ id: projectCategories.categoryId })
        .from(projectCategories)
        .where(eq(projectCategories.projectId, projectId))
    ).map((r) => r.id);
    const dropped = current.filter((id) => !newSet.includes(id));
    if (dropped.length > 0) {
      await tx
        .delete(projectCategories)
        .where(
          and(
            eq(projectCategories.projectId, projectId),
            inArray(projectCategories.categoryId, dropped)
          )
        );
    }
    savePidOnceDeleted.resolve(pid);
    await gate.promise;
    const added = newSet.filter((id) => !current.includes(id)).sort();
    if (added.length > 0) {
      await tx
        .insert(projectCategories)
        .values(added.map((categoryId) => ({ projectId, categoryId })));
    }
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
 * Runs `statement` in a transaction of its own and keeps it open, with the
 * rows it locked, until `release` commits it: a fixed point for a writer
 * under test to wait at. Release it in a `finally`, or the open transaction
 * blocks the next test's truncate.
 */
export async function holdOpen(
  statement: SQL
): Promise<{ pid: number; release: () => Promise<void> }> {
  const started = deferred<number>();
  const gate = deferred<void>();
  const held = db.transaction(async (tx) => {
    const result = await tx.execute(sql`select pg_backend_pid() as pid`);
    const [{ pid }] = result.rows as { pid: number }[];
    await tx.execute(statement);
    started.resolve(pid);
    await gate.promise;
  });
  // `held` settles first only when the statement throws, and then rejects.
  const pid = await Promise.race([started.promise, held.then(() => -1)]);
  return {
    pid,
    release: async () => {
      gate.resolve();
      await held;
    },
  };
}

/**
 * Polls until some backend is blocked by `pid`, and returns that backend's
 * pid. Asked of one pid rather than of every lock wait on the database, so a
 * dev server's lock waits cannot end the poll early; another integration
 * run's truncate, queued behind the same transaction, still could. Fails
 * rather than going on, so the blocker cannot commit first and pass the test
 * for nothing, and gives up after about two seconds, inside Vitest's own
 * five-second timeout, so this error is the one reported.
 */
export async function untilABackendWaitsOn(pid: number): Promise<number> {
  for (let i = 0; i < 100; i++) {
    const waiter = await backendWaitingOn(pid);
    if (waiter !== null) {
      return waiter;
    }
    await pause();
  }
  throw new Error(`No backend ever waited on ${pid}.`);
}

/**
 * Polls until `running` settles or some backend is blocked by `pid`: a writer
 * that should finish beside a held transaction, where a regression would
 * leave it waiting on that transaction instead. Gives up like
 * `untilABackendWaitsOn`.
 */
export async function untilSettledOrWaitingOn(
  running: Promise<unknown>,
  pid: number
): Promise<void> {
  let settled = false;
  running.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    }
  );
  for (let i = 0; i < 100; i++) {
    if (settled || (await backendWaitingOn(pid)) !== null) {
      return;
    }
    await pause();
  }
  throw new Error(`The writer neither finished nor waited on ${pid}.`);
}

async function backendWaitingOn(pid: number): Promise<number | null> {
  const result = await db.execute(
    sql`select pid from pg_stat_activity where ${pid}::int = any(pg_blocking_pids(pid)) limit 1`
  );
  const [row] = result.rows as { pid: number }[];
  return row?.pid ?? null;
}

function pause() {
  return new Promise((resolve) => setTimeout(resolve, 20));
}
