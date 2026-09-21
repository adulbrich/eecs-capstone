import { once } from "node:events";
import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { db } from "#/db";

/**
 * The guard in `logPoolErrors`, against a real server rather than a synthetic
 * emit. The unit tests beside it assert `EventEmitter` semantics, which is a
 * different claim: this one proves a backend the server kills actually
 * reaches that listener, and that the pool still works afterwards.
 *
 * It is here rather than in the unit suite because it needs a database whose
 * connections it can terminate, and it is worth the cost because the guard is
 * invisible. Nothing about a refactor back to `drizzle({ connection })` would
 * look wrong in review; this is what would fail.
 */
const pool = (db as unknown as { $client: pg.Pool }).$client;

describe("a backend the server terminates", () => {
  it("does not take the process down, and the pool keeps working", async () => {
    // First, and before anything attaches a listener of its own. Waiting on
    // the pool's error event below would itself satisfy `EventEmitter`, so
    // without this assertion the test would pass with the guard deleted.
    // This way a missing guard is one red line rather than a worker that
    // dies mid-run and surfaces as an unhandled error somewhere else.
    expect(pool.listenerCount("error")).toBeGreaterThan(0);

    const client = await pool.connect();
    const { rows } = await client.query<{ pid: number }>(
      "select pg_backend_pid() as pid"
    );
    const pid = rows[0]?.pid;
    expect(pid).toBeGreaterThan(0);
    // Back to the pool, idle, which is the state pg-pool's error path is
    // written for.
    client.release();

    const dropped = once(pool, "error");

    // A second connection, because a backend cannot terminate itself.
    const killer = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
    });
    try {
      const killResult = await killer.query<{ killed: boolean }>(
        "select pg_terminate_backend($1) as killed",
        [pid]
      );
      // Without this the test passes when the pid is already gone, having
      // exercised nothing at all.
      expect(killResult.rows[0]?.killed).toBe(true);
    } finally {
      await killer.end();
    }

    // Waiting on the event rather than sleeping a guessed interval. This is
    // the assertion that pg-pool routed the dropped socket to the pool at
    // all, which is the half a synthetic emit cannot show.
    const [error] = (await dropped) as [Error];
    expect(error.message).toContain("terminating connection");

    const after = await db.execute(sql`select 1 as ok`);
    expect(after.rows).toEqual([{ ok: 1 }]);
    // Above the default 5s only for headroom on a loaded CI runner. The
    // work here is milliseconds: `pg_terminate_backend` sends FATAL and
    // closes at once, and it measures under a second locally.
  }, 10_000);
});
