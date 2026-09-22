import type { Pool, PoolConfig } from "pg";

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
 * 220, leaving ten for a second one-off script or a hand-held psql. A cap,
 * not a floor: pg-pool opens lazily and closes clients idle for 10 s, so a
 * quiet task holds far fewer.
 */
const POOL_MAX = 45;

/**
 * How long a request waits for a connection before failing. pg-pool applies
 * it to the queue wait when the pool is full and to the TCP connect itself,
 * so an exhausted pool surfaces as a fast error rather than as requests that
 * hang until CloudFront's 30 s origin timeout. Hanging is the worse failure
 * here because `/api/healthz` never touches the database on purpose, so
 * nothing would restart the task.
 */
const ACQUIRE_TIMEOUT_MS = 5000;

export function poolConfig(connectionString: string): PoolConfig {
  return {
    connectionString,
    max: POOL_MAX,
    connectionTimeoutMillis: ACQUIRE_TIMEOUT_MS,
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
