/**
 * The three numbers that decide when a day of traffic is final, in one
 * place because each is only safe beside the others (ADR-0050).
 *
 * The rollup in `src/server/_internal/traffic.ts` never revisits a day once
 * it holds a later one, so an event must never commit more than
 * `ROLLUP_SETTLE_MS` after the time it is stamped with. The writer
 * guarantees that: it drops an event already `MAX_EVENT_LAG_MS` old by the
 * time it would insert, and every statement on its pool, the salt lock wait
 * included, is cut off at `TRAFFIC_STATEMENT_TIMEOUT_MS`. The sum stays
 * well under the settle margin, which also absorbs clock skew between
 * tasks. `traffic-timing.test.ts` holds the inequality.
 */

/** How old an event may be, by its own stamp, when its insert starts. */
export const MAX_EVENT_LAG_MS = 30_000;

/** The traffic writer's pool cuts off any statement, and lock wait, here. */
export const TRAFFIC_STATEMENT_TIMEOUT_MS = 10_000;

/** How long after local midnight a day of traffic counts as closed. */
export const ROLLUP_SETTLE_MS = 2 * 60 * 1000;
