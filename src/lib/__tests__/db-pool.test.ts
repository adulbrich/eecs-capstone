import { describe, expect, it } from "vitest";
import { CONNECTION_BUDGET, poolConfig } from "../_internal/db-pool";

const URL_WITH_ENCODED_PASSWORD =
  "postgresql://app:p%40ss%2Fword@db.internal:5432/eecs_capstone?sslmode=require";

describe("poolConfig", () => {
  it("passes the connection string through untouched", () => {
    // pg parses the URL itself, so any decoding here would double-decode
    // a password with reserved characters.
    expect(poolConfig(URL_WITH_ENCODED_PASSWORD).connectionString).toBe(
      URL_WITH_ENCODED_PASSWORD
    );
  });

  it("raises the pool above pg-pool's default of ten, which production was pinned at", () => {
    // node_modules/pg-pool/index.js: `max || poolSize || 10`. RDS
    // DatabaseConnections sat at exactly 10 for a week with a handful of
    // staff signed in (#521).
    const max = poolConfig(URL_WITH_ENCODED_PASSWORD).max;
    expect(max).toBeGreaterThan(10);
  });

  it("bounds how long a request waits for a connection", () => {
    // Without it a full pool means every database-backed request hangs
    // until CloudFront gives up on the origin, while healthz stays green.
    const timeout = poolConfig(
      URL_WITH_ENCODED_PASSWORD
    ).connectionTimeoutMillis;
    expect(timeout).toBeGreaterThan(0);
    expect(timeout).toBeLessThan(30_000);
  });

  it("keeps the whole fleet inside what the RDS instance can hold", () => {
    // The ceiling this rests on: every app task at its pool maximum plus the
    // collector reservation, with the migration one-off open beside them
    // during a deploy, stays under the instance's usable connections. Raising
    // `max`, the task ceiling or the collector share has to keep this true.
    const { max } = poolConfig(URL_WITH_ENCODED_PASSWORD);
    const perTask = (max ?? 0) + CONNECTION_BUDGET.collectorPerTask;
    const fleet =
      perTask * CONNECTION_BUDGET.taskCeiling + CONNECTION_BUDGET.migration;
    expect(fleet).toBeLessThanOrEqual(CONNECTION_BUDGET.rdsUsable);
  });
});
