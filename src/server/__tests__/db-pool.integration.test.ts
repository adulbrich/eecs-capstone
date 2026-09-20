import { sql } from "drizzle-orm";
import pg from "pg";
import { describe, expect, it } from "vitest";
import { db } from "#/db";

/**
 * The guard in `logPoolErrors`, against a real server rather than a synthetic
 * emit. The unit tests next to it assert `EventEmitter` semantics, which is
 * not the same claim: this one proves that a backend the server kills reaches
 * that listener, and that the pool is still usable afterwards.
 *
 * It is here rather than in the unit suite because it needs a database it can
 * terminate a connection on, and it is worth the cost because the guard is
 * invisible. Nothing about a later refactor back to `drizzle({ connection })`
 * would look wrong; this is what would fail.
 */
const pool = (db as unknown as { $client: pg.Pool }).$client;

describe("a backend the server terminates", () => {
  it("does not take the process down, and the pool keeps working", async () => {
    const client = await pool.connect();
    const { rows } = await client.query<{ pid: number }>(
      "select pg_backend_pid() as pid"
    );
    const pid = rows[0]?.pid;
    expect(pid).toBeGreaterThan(0);
    // Back to the pool, idle, which is the state pg-pool's error path is for.
    client.release();

    // A second connection, because a backend cannot terminate itself.
    const killer = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
    });
    try {
      await killer.query("select pg_terminate_backend($1)", [pid]);
    } finally {
      await killer.end();
    }

    // Without the listener the emit below throws out of a socket callback and
    // the worker dies, so the failure mode is a dead run rather than a red
    // assertion. Give the notification time to arrive before asserting.
    await new Promise((resolve) => setTimeout(resolve, 500));

    const after = await db.execute(sql`select 1 as ok`);
    expect(after.rows).toEqual([{ ok: 1 }]);
  });
});
