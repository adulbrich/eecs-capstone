import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { Client, Pool } from "pg";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTION_BUDGET,
  logPoolErrors,
  POOL_METRICS,
  POOL_MIN,
  poolConfig,
  poolMetricsLine,
  startPoolMetrics,
  warmPool,
} from "../_internal/db-pool";

const QUOTES = /^"|"$/g;

/**
 * A `<name> = <value>` argument inside one top-level block of a Terraform
 * file, found by the line that opens the block, with any quotes stripped.
 * Undefined when either is missing.
 */
function terraformArgument(
  file: string,
  opener: string,
  name: string
): string | undefined {
  const source = readFileSync(file, "utf8");
  const block = source.split(opener)[1]?.split("\n}")[0];
  const line = (block ?? "")
    .split("\n")
    .find((candidate) => candidate.trim().startsWith(`${name} `));
  return line?.split("=")[1]?.trim().replace(QUOTES, "");
}

/** The same, as a number: NaN when missing, which fails loudly downstream. */
function terraformNumber(file: string, opener: string, name: string): number {
  return Number(terraformArgument(file, opener, name));
}

/** A variable's `default` in `infra/variables.tf`. */
function terraformDefault(name: string): number {
  return terraformNumber(
    "infra/variables.tf",
    `variable "${name}" {`,
    "default"
  );
}

/** An argument on the app service in `infra/ecs.tf`. */
function serviceSetting(name: string): number {
  return terraformNumber(
    "infra/ecs.tf",
    'resource "aws_ecs_service" "app" {',
    name
  );
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
    // `app_max_tasks`, or the deploy's `deployment_maximum_percent`, without
    // raising `taskCeiling` silently overruns the instance, which is the
    // failure ADR-0034 exists to prevent. At 100 percent a deploy replaces
    // tasks one at a time and the ceiling is the scaling maximum itself; the
    // AWS default of 200 would double it (ADR-0043). `ceil` rather than the
    // floor ECS applies, so a fractional percentage rounds the budget up,
    // never down.
    const maximumPercent = serviceSetting("deployment_maximum_percent");
    expect(maximumPercent).toBeGreaterThan(0);
    expect(CONNECTION_BUDGET.taskCeiling).toBe(
      Math.ceil((terraformDefault("app_max_tasks") * maximumPercent) / 100)
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

    // `inspect` rather than `String`. An Error's own toString prints only
    // name and message, so a `String()` assertion would pass on an
    // implementation that handed the whole error object to the logger and
    // left the attached client to be rendered downstream.
    const line = inspect(logged[0]);
    expect(line).toContain("terminating connection");
    expect(line).not.toContain("db.internal");
    expect(line).not.toContain("eecs_capstone");
  });
});

/** An argument on the pool alarm in `infra/alarms.tf`. */
function poolAlarmSetting(name: string): string | undefined {
  return terraformArgument(
    "infra/alarms.tf",
    'resource "aws_cloudwatch_metric_alarm" "db_pool_waiting" {',
    name
  );
}

describe("pool metrics", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function fakePool(counts: { waiting: number; total: number; idle: number }) {
    return {
      get waitingCount() {
        return counts.waiting;
      },
      get totalCount() {
        return counts.total;
      },
      get idleCount() {
        return counts.idle;
      },
    };
  }

  it("writes one Embedded Metric Format document with the samples as arrays", () => {
    const line = poolMetricsLine(
      { waiting: [0, 3], total: [45, 45], idle: [2, 0] },
      1_700_000_000_000
    );
    // One line: CloudWatch reads the whole log event as the document, so
    // anything before or after the JSON, a newline included, breaks it.
    expect(line).not.toContain("\n");
    const doc = JSON.parse(line);
    expect(doc._aws.Timestamp).toBe(1_700_000_000_000);
    const [directive] = doc._aws.CloudWatchMetrics;
    expect(directive.Namespace).toBe(POOL_METRICS.namespace);
    // An empty dimension set: fleet-wide, one metric however many tasks.
    expect(directive.Dimensions).toEqual([[]]);
    expect(directive.Metrics.map((m: { Name: string }) => m.Name)).toEqual([
      POOL_METRICS.waiting,
      POOL_METRICS.total,
      POOL_METRICS.idle,
    ]);
    // Every metric named in the directive must be a member of the root.
    expect(doc[POOL_METRICS.waiting]).toEqual([0, 3]);
    expect(doc[POOL_METRICS.total]).toEqual([45, 45]);
    expect(doc[POOL_METRICS.idle]).toEqual([2, 0]);
  });

  it("emits one line per calendar minute, stamped with the minute it holds", () => {
    // Started mid-minute, as a task is: the first line is a partial minute,
    // and every line lands in the minute its samples came from, so the
    // alarm's two-in-a-row count sees each minute exactly once.
    vi.useFakeTimers();
    vi.setSystemTime(30_000);
    const counts = { waiting: 0, total: 10, idle: 10 };
    const lines: string[] = [];
    const stop = startPoolMetrics(fakePool(counts), {
      emit: (line) => lines.push(line),
    });

    vi.advanceTimersByTime(29_000);
    expect(lines).toHaveLength(0);
    counts.waiting = 7;
    vi.advanceTimersByTime(1000);
    expect(lines).toHaveLength(1);
    const first = JSON.parse(lines[0]);
    expect(first._aws.Timestamp).toBe(0);
    expect(first[POOL_METRICS.waiting]).toEqual(new Array(29).fill(0));

    vi.advanceTimersByTime(60_000);
    expect(lines).toHaveLength(2);
    const second = JSON.parse(lines[1]);
    expect(second._aws.Timestamp).toBe(60_000);
    expect(second[POOL_METRICS.waiting]).toEqual(new Array(60).fill(7));

    stop();
    vi.advanceTimersByTime(120_000);
    expect(lines).toHaveLength(2);
  });

  it("never puts more than EMF's hundred values in one line", () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const lines: string[] = [];
    const stop = startPoolMetrics(fakePool({ waiting: 0, total: 1, idle: 1 }), {
      emit: (line) => lines.push(line),
      sampleMs: 1,
      windowMs: 1_000_000,
    });
    vi.advanceTimersByTime(250);
    stop();
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(JSON.parse(line)[POOL_METRICS.waiting]).toHaveLength(100);
    }
  });

  it("names the metric the alarm in infra/alarms.tf watches", () => {
    // The alarm is the only reader. A rename on either side would leave it
    // watching a metric nothing publishes, which under `notBreaching` is an
    // alarm that stays OK forever.
    expect(poolAlarmSetting("namespace")).toBe(POOL_METRICS.namespace);
    expect(poolAlarmSetting("metric_name")).toBe(POOL_METRICS.waiting);
  });
});

describe("keeping connections warm", () => {
  it("holds a floor inside the cap when asked to keep warm", () => {
    // A floor below `max` leaves the budget test above unchanged: `min` only
    // exempts clients from the idle timeout, it never opens past `max` (#601).
    const { min, max } = poolConfig(URL_WITH_ENCODED_PASSWORD, {
      keepWarm: true,
    });
    expect(min).toBe(POOL_MIN);
    expect(POOL_MIN).toBeGreaterThan(0);
    expect(POOL_MIN).toBeLessThan(max ?? 0);
  });

  it("lets a process exit with the floor still open", () => {
    // A client under `min` never times out, so without this a script that
    // imports `#/db` with the floor on would hold the event loop forever.
    expect(
      poolConfig(URL_WITH_ENCODED_PASSWORD, { keepWarm: true }).allowExitOnIdle
    ).toBe(true);
  });

  it("keeps no floor by default, for dev, tests and scripts", () => {
    expect(poolConfig(URL_WITH_ENCODED_PASSWORD).min ?? 0).toBe(0);
  });
});

/** A pool that counts how many connects are in flight at once. */
function countingPool(fail = 0) {
  let inFlight = 0;
  let peak = 0;
  let released = 0;
  let remainingFailures = fail;
  return {
    stats: () => ({ peak, released }),
    connect: async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight--;
      if (remainingFailures > 0) {
        remainingFailures--;
        throw new Error("connect ECONNREFUSED 10.0.0.5:5432");
      }
      return {
        release: () => {
          released++;
        },
      };
    },
  };
}

describe("warmPool", () => {
  it("opens every client at once rather than reusing one", async () => {
    // A connect-then-release loop would hand the same idle client back each
    // time and leave the pool holding one.
    const pool = countingPool();
    await warmPool(pool, 5, () => undefined);
    expect(pool.stats()).toEqual({ peak: 5, released: 5 });
  });

  it("logs one redacted line and does not throw when a connect fails", async () => {
    const pool = countingPool(2);
    const logged: string[] = [];
    await expect(
      warmPool(pool, 5, (line) => logged.push(line))
    ).resolves.toBeUndefined();
    expect(pool.stats().released).toBe(3);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toContain("3 of 5");
    expect(logged[0]).toContain("ECONNREFUSED");
  });

  it("says nothing when every client opened", async () => {
    const logged: string[] = [];
    await warmPool(countingPool(), 5, (line) => logged.push(line));
    expect(logged).toEqual([]);
  });
});
