import type { PoolConfig } from "pg";

/**
 * How many connections the fleet may hold open at once, and where the number
 * comes from. Pure, so the unit test can hold the sum to the ceiling.
 *
 * The binding constraint is the RDS instance, not the task. `db.t4g.micro`
 * has 1 GiB, which the RDS formula turns into 112 `max_connections`; Postgres
 * keeps 3 for superusers and RDS 2 more for its own, so 107 are usable. Its
 * freeable memory sat between 131 and 176 MB with ten backends open, and each
 * backend costs a few MB more, which is what caps the per-task pool well
 * below the raw arithmetic. Task memory is not the limit: an idle client
 * measured at 0.11 MB of RSS, so twenty are about 2 MB of the 512 MB task.
 *
 * `taskCeiling` is the most app tasks the budget allows at once. A deploy
 * already makes two, old and new, and #522 may raise it with autoscaling.
 * `oneOffScript` is pg's default pool that `scripts/migrate.mjs` and the
 * other one-off scripts open beside the fleet; `migrate()` uses one session
 * of it, so this is a reservation, not a measurement. `trafficPerTask` is
 * reserved for the site traffic writer's own pool (#18), which ADR-0034 keeps
 * separate so a flood of anonymous writes cannot starve page rendering. See
 * the ADR before changing any of these.
 */
export const CONNECTION_BUDGET = {
  rdsUsable: 107,
  taskCeiling: 3,
  oneOffScript: 10,
  trafficPerTask: 5,
} as const;

/**
 * Connections one app task holds at most. pg-pool defaulted to 10, and RDS
 * `DatabaseConnections` sat at exactly 10 for a week under a handful of
 * staff (#521): no headroom before requests queue. 20 doubles it and, with
 * the traffic writer's 5, fits three tasks plus a one-off script inside
 * `rdsUsable`. A cap, not a floor: pg-pool opens lazily and closes clients
 * idle for 10 s, so a quiet task holds far fewer.
 */
const POOL_MAX = 20;

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
