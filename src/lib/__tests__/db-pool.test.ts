import { readFileSync } from "node:fs";
import { Client, Pool } from "pg";
import { describe, expect, it } from "vitest";
import {
  CONNECTION_BUDGET,
  logPoolErrors,
  poolConfig,
} from "../_internal/db-pool";

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

describe("surviving a connection the server drops", () => {
  it("would crash the process without a listener, which is the hazard", () => {
    // pg-pool's idle listener removes the client and then emits on the pool
    // (node_modules/pg-pool/index.js, makeIdleListener). An EventEmitter with
    // no `error` listener throws on that emit, and a throw from a socket
    // callback is an uncaught exception, so the task exits (#525).
    const bare = new Pool({ connectionString: URL_WITH_ENCODED_PASSWORD });
    expect(() =>
      bare.emit("error", new Error("terminating connection"))
    ).toThrow("terminating connection");
  });

  it("logs the error and stays up once the listener is attached", () => {
    const pool = new Pool({ connectionString: URL_WITH_ENCODED_PASSWORD });
    const logged: unknown[] = [];
    logPoolErrors(pool, (message) => logged.push(message));

    expect(() =>
      pool.emit("error", new Error("terminating connection"))
    ).not.toThrow();
    expect(logged).toHaveLength(1);
    expect(String(logged[0])).toContain("terminating connection");
  });

  it("says nothing the attached client would expose", () => {
    // pg-pool sets `err.client = client` before it emits, and inspecting a
    // client prints its connection parameters. The error therefore has to
    // carry one for this to be able to fail: with a bare Error there is
    // nothing to leak and logging the whole object would pass.
    const pool = new Pool({ connectionString: URL_WITH_ENCODED_PASSWORD });
    const logged: unknown[] = [];
    logPoolErrors(pool, (message) => logged.push(message));

    const error = new Error("terminating connection") as Error & {
      client: Client;
    };
    error.client = new Client({ connectionString: URL_WITH_ENCODED_PASSWORD });
    pool.emit("error", error);

    const line = String(logged[0]);
    expect(line).toContain("terminating connection");
    expect(line).not.toContain("db.internal");
    expect(line).not.toContain("eecs_capstone");
  });
});
