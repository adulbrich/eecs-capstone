import type { Pool, PoolConfig } from "pg";
import { redactQueryError } from "./redact-query-error";
import { TRAFFIC_STATEMENT_TIMEOUT_MS } from "./traffic-timing";

/**
 * How many connections the fleet may hold open at once, and where the number
 * comes from. Pure, so the unit test can hold the sum to the ceiling.
 *
 * The binding constraint is the RDS instance, not the task. `db.t4g.small`
 * has 2 GiB, which the RDS formula turns into 225 `max_connections`; Postgres
 * keeps 3 for superusers and RDS 2 more for its own, so 220 are usable. Task
 * memory is not the limit: an idle client measured at 0.11 MB of RSS, so
 * twenty are about 2 MB of the 1024 MB task.
 *
 * `taskCeiling` is the most app tasks the budget allows at once: the
 * autoscaling ceiling of four in `infra/variables.tf`, times the service's
 * `deployment_maximum_percent` in `infra/ecs.tf`. That is 100, so a deploy
 * stops a task before it starts its replacement and the ceiling is four.
 * It used to be eight, because the AWS default of 200 runs old and new side
 * by side, and that doubling is what held the pool at 20 (ADR-0043).
 * `oneOffScript` is pg's default pool that `scripts/migrate.mjs` and the
 * other one-off scripts open beside the fleet; `migrate()` uses one session
 * of it, so this is a reservation, not a measurement. `trafficPerTask` is
 * reserved for the site traffic writer's own pool (#18), which ADR-0034 keeps
 * separate so a flood of anonymous writes cannot starve page rendering. See
 * the ADR before changing any of these.
 */
export const CONNECTION_BUDGET = {
  rdsUsable: 220,
  taskCeiling: 4,
  oneOffScript: 10,
  trafficPerTask: 5,
} as const;

/**
 * Connections one app task holds at most. pg-pool defaulted to 10, and RDS
 * `DatabaseConnections` sat at exactly 10 for a week under a handful of
 * staff (#521). 20 was the most eight tasks could hold, and the #524 load
 * test pinned three tasks at 59 of 60 during a term start burst while CPU
 * still had room, with session lookups failing on the acquire timeout
 * (#558). With the ceiling at four, 45 fits: (45 + 5) * 4 + 10 = 210 of
 * 220, leaving ten for a second one-off script or a hand-held psql. A cap:
 * pg-pool opens lazily and closes clients idle for 10 s, so a quiet task
 * holds no more than `POOL_MIN` in production and none elsewhere.
 */
const POOL_MAX = 45;

/**
 * Connections a production task keeps open through a lull (#601, ADR-0052).
 * Twice a load-test burst drew one 500 from a task whose pool had nothing
 * open: its 0.25 vCPU was saturated serving the burst while it opened TLS
 * connections to RDS, and a connect past `ACQUIRE_TIMEOUT_MS` fails the
 * request. `min` exempts the first five from the idle timeout, so a lull no
 * longer closes them; `warmPool` opens them at boot, because `min` alone
 * never opens anything. Nothing reopens one that drops (an RDS failover or
 * reboot): pg-pool removes it and the floor refills only as demand opens
 * connections again, so the first burst after a drop can start below five.
 * Inside `POOL_MAX`, so the budget above is unchanged; the resting count is
 * five per task.
 */
export const POOL_MIN = 5;

/**
 * How long a request waits for a connection before failing. pg-pool applies
 * it to the queue wait when the pool is full and to the TCP connect itself,
 * so an exhausted pool surfaces as a fast error rather than as requests that
 * hang until CloudFront's 30 s origin timeout. Hanging is the worse failure
 * here because `/api/healthz` never touches the database on purpose, so
 * nothing would restart the task.
 */
export const ACQUIRE_TIMEOUT_MS = 5000;

/**
 * The app pool. `keepWarm` is for the production server only: a client under
 * `min` is never closed, so anywhere a module can be evaluated twice (dev
 * HMR, a test worker) would hold a stale pool's floor open for good.
 * `allowExitOnIdle` goes with it so that a script run with the floor on can
 * still exit once its work is done.
 */
export function poolConfig(
  connectionString: string,
  { keepWarm = false }: { keepWarm?: boolean } = {}
): PoolConfig {
  return {
    connectionString,
    max: POOL_MAX,
    connectionTimeoutMillis: ACQUIRE_TIMEOUT_MS,
    ...(keepWarm ? { min: POOL_MIN, allowExitOnIdle: true } : {}),
  };
}

/**
 * Opens `count` clients at once, `POOL_MIN` unless a test says otherwise, and
 * hands them back, so the pool holds that many idle and `min` keeps them. At once rather than in a loop: a
 * connect-then-release loop gets the same idle client back every time and
 * leaves one open. Never throws, because a task that cannot reach the
 * database at boot should still come up and answer `/api/healthz`; a failed
 * connect is one line, redacted (ADR-0042), and the pool opens the missing
 * clients on demand as it did before.
 */
export async function warmPool(
  pool: { connect: () => Promise<{ release: () => void }> },
  count: number = POOL_MIN,
  log: (message: string) => void = console.error
): Promise<void> {
  // Each connect goes through `then` so that one throwing before it returns
  // a promise (pg-pool does, on a connection string it cannot parse or a
  // missing `sslrootcert`) settles as a rejection here rather than escaping
  // `allSettled` as an unhandled one with the raw error attached.
  const results = await Promise.allSettled(
    Array.from({ length: count }, () =>
      Promise.resolve().then(() => pool.connect())
    )
  );
  let opened = 0;
  let firstFailure: unknown;
  for (const result of results) {
    if (result.status === "fulfilled") {
      try {
        result.value.release();
        opened++;
      } catch (error) {
        firstFailure ??= error;
      }
    } else {
      firstFailure ??= result.reason;
    }
  }
  if (opened < count) {
    log(
      `Database pool warm-up opened ${opened} of ${count}: ${redactQueryError(firstFailure)}`
    );
  }
}

/**
 * The traffic writer's own pool (ADR-0034): `trafficPerTask` connections and
 * no more, apart from the app pool so a flood of anonymous writes cannot
 * starve page rendering. The writer drops an event rather than wait once that
 * many are in flight, so the acquire timeout here only bounds a stalled
 * connect.
 */
export function trafficPoolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: CONNECTION_BUDGET.trafficPerTask,
    connectionTimeoutMillis: ACQUIRE_TIMEOUT_MS,
    // Bounds every statement, the salt's lock wait included, so an event
    // cannot commit after the rollup closes its day (traffic-timing.ts).
    statement_timeout: TRAFFIC_STATEMENT_TIMEOUT_MS,
  };
}

/**
 * Keeps a dropped connection from taking the task down with it.
 *
 * When the server closes an idle connection, pg-pool's idle listener removes
 * the client and then calls `pool.emit("error", ...)`. An `EventEmitter` with
 * no `error` listener throws on that emit, and the throw arrives on a socket
 * callback rather than inside a request, so nothing catches it and the
 * process exits. One RDS restart or failover was therefore one outage (#525).
 * pg-pool has already discarded the client by the time this runs, so there is
 * nothing to clean up and the next acquisition opens a fresh connection.
 *
 * Logs `error.message` and nothing else on purpose: pg-pool attaches the
 * client to the error (`err.client = client`), and inspecting a client prints
 * its connection parameters. The password is not among them, since `pg`
 * defines that one non-enumerable, but the host, the user and the database
 * name are, and none of them belongs in a log line about a dropped socket.
 */
export function logPoolErrors(
  pool: Pool,
  log: (message: string) => void = console.error
): void {
  pool.on("error", (error: Error) => {
    log(`Database pool dropped a connection: ${error.message}`);
  });
}

/**
 * Where the pool metrics land in CloudWatch. `infra/alarms.tf` alarms on
 * `waiting` by these names, and `db-pool.test.ts` holds the two together.
 */
export const POOL_METRICS = {
  namespace: "eecs-capstone/db-pool",
  waiting: "PoolWaiting",
  total: "PoolTotal",
  idle: "PoolIdle",
} as const;

type PoolCounts = Pick<Pool, "totalCount" | "idleCount" | "waitingCount">;

interface PoolSamples {
  idle: number[];
  total: number[];
  waiting: number[];
}

/**
 * One CloudWatch Embedded Metric Format document, as the single line the log
 * event must be: CloudWatch extracts the metrics from any JSON log event that
 * carries `_aws`, so stdout through the task's `awslogs` driver is enough and
 * the task needs no SDK client and no `cloudwatch:PutMetricData`.
 *
 * Each metric is an array of samples rather than a pre-computed maximum, so
 * CloudWatch keeps the distribution and `Maximum`, `Average` and the
 * percentiles all mean what they say. No dimensions, on purpose: a task id
 * would be a new custom metric on every deploy, and the question is whether
 * any task had a queue, which the fleet-wide `Maximum` answers. Counts only,
 * never a query or its parameters (ADR-0042).
 */
export function poolMetricsLine(
  samples: PoolSamples,
  timestamp: number
): string {
  const metric = (name: string) => ({ Name: name, Unit: "Count" });
  return JSON.stringify({
    _aws: {
      Timestamp: timestamp,
      CloudWatchMetrics: [
        {
          Namespace: POOL_METRICS.namespace,
          Dimensions: [[]],
          Metrics: [
            metric(POOL_METRICS.waiting),
            metric(POOL_METRICS.total),
            metric(POOL_METRICS.idle),
          ],
        },
      ],
    },
    [POOL_METRICS.waiting]: samples.waiting,
    [POOL_METRICS.total]: samples.total,
    [POOL_METRICS.idle]: samples.idle,
  });
}

/** EMF refuses more than this many values for one metric in one document. */
const EMF_MAX_VALUES = 100;

/**
 * Samples the pool's three counts every `sampleMs` and emits them as one EMF
 * line per calendar minute (#558). Returns the stop function.
 *
 * `waitingCount` is the number that matters: a request queued for a
 * connection is a request that is slow for that reason, and past the
 * acquire timeout it fails. The session lookups that failed that way in the
 * #524 load test were the only signal the pool had run out, and ADR-0042's
 * redaction makes that line far harder to spot, so this is its deliberate
 * replacement. Sampled rather than timed per acquire, because timing needs a
 * wrapper on `pool.connect` that relies on pg-pool calling its own `connect`
 * from `query`. A queue that forms and drains between two samples is missed.
 *
 * A line holds the samples of one calendar minute and is stamped with that
 * minute's start, so each full minute a task was up gets one datapoint in the
 * minute it describes. Emitting every sixtieth tick instead stamped a minute of
 * samples with whichever minute the sixtieth landed in, and let timer drift
 * leave a minute empty or give it two lines. The line for a minute goes out on
 * the first tick of the next, and a document that would pass EMF's cap goes
 * out early. Nothing flushes on shutdown, so a task's last partial minute is
 * lost; the alarm needs two minutes in a row, so that minute can neither fire
 * it nor clear it.
 *
 * The interval is unref'd so a script that imports `#/db` still exits when
 * its work is done.
 */
export function startPoolMetrics(
  pool: PoolCounts,
  {
    emit = (line: string) => console.log(line),
    now = Date.now,
    sampleMs = 1000,
    windowMs = 60_000,
  }: {
    emit?: (line: string) => void;
    now?: () => number;
    sampleMs?: number;
    windowMs?: number;
  } = {}
): () => void {
  const empty = (): PoolSamples => ({ idle: [], total: [], waiting: [] });
  let samples = empty();
  let windowStart = Math.floor(now() / windowMs) * windowMs;
  const flush = () => {
    if (samples.waiting.length > 0) {
      emit(poolMetricsLine(samples, windowStart));
    }
    samples = empty();
  };
  const timer = setInterval(() => {
    const start = Math.floor(now() / windowMs) * windowMs;
    if (start !== windowStart || samples.waiting.length >= EMF_MAX_VALUES) {
      flush();
      windowStart = start;
    }
    samples.waiting.push(pool.waitingCount);
    samples.total.push(pool.totalCount);
    samples.idle.push(pool.idleCount);
  }, sampleMs);
  timer.unref();
  return () => clearInterval(timer);
}
