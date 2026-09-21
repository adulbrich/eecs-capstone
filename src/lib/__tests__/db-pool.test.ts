import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CONNECTION_BUDGET, poolConfig } from "../_internal/db-pool";

/** A `default = <number>` inside one named block of `infra/variables.tf`. */
function terraformDefault(name: string): number {
  const source = readFileSync("infra/variables.tf", "utf8");
  const block = source.split(`variable "${name}" {`)[1]?.split("\n}")[0];
  return Number(/default\s*=\s*(\d+)/.exec(block ?? "")?.[1]);
}

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
    // node_modules/pg-pool/index.js: `max || poolSize || 10`, the number
    // production sat at (#521).
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

  it("counts every task a deploy can run, not just the scaling ceiling", () => {
    // The budget's task count and the Terraform ceiling are two writings of
    // one number, and nothing but this connects them: raising
    // `app_max_tasks` without raising `taskCeiling` silently overruns the
    // instance, which is the failure ADR-0034 exists to prevent. The factor
    // of two is the deploy, which runs old and new side by side because the
    // service leaves `maximumPercent` at the AWS default of 200.
    expect(CONNECTION_BUDGET.taskCeiling).toBe(
      2 * terraformDefault("app_max_tasks")
    );
  });

  it("keeps the whole fleet inside what the RDS instance can hold", () => {
    // The ceiling this rests on: every app task at its pool maximum plus the
    // traffic writer's reservation, with a one-off script's pool open beside
    // them, stays under the instance's usable connections. Raising `max`,
    // the task ceiling or the traffic share has to keep this true.
    const { max } = poolConfig(URL_WITH_ENCODED_PASSWORD);
    const perTask = (max ?? 0) + CONNECTION_BUDGET.trafficPerTask;
    const fleet =
      perTask * CONNECTION_BUDGET.taskCeiling + CONNECTION_BUDGET.oneOffScript;
    expect(fleet).toBeLessThanOrEqual(CONNECTION_BUDGET.rdsUsable);
  });
});
