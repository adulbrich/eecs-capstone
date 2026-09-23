import { describe, expect, it } from "vitest";
import { ACQUIRE_TIMEOUT_MS, trafficPoolConfig } from "#/lib/_internal/db-pool";
import {
  MAX_EVENT_LAG_MS,
  ROLLUP_SETTLE_MS,
  TRAFFIC_STATEMENT_TIMEOUT_MS,
} from "#/lib/_internal/traffic-timing";

describe("when a day of traffic is final", () => {
  it("settles only after the latest an event can commit, with room for clock skew", () => {
    // An event can wait MAX_EVENT_LAG_MS before its insert starts, then
    // ACQUIRE_TIMEOUT_MS for a connection, then TRAFFIC_STATEMENT_TIMEOUT_MS
    // for the insert; the rollup must wait longer than all three, with room
    // for clock skew, or it can close a day under a commit still in flight
    // and lose that event for good.
    expect(
      MAX_EVENT_LAG_MS + ACQUIRE_TIMEOUT_MS + TRAFFIC_STATEMENT_TIMEOUT_MS
    ).toBeLessThanOrEqual(ROLLUP_SETTLE_MS / 2);
  });

  it("is enforced on the traffic writer's pool", () => {
    const config = trafficPoolConfig("postgres://x");
    expect(config.statement_timeout).toBe(TRAFFIC_STATEMENT_TIMEOUT_MS);
    expect(config.connectionTimeoutMillis).toBe(ACQUIRE_TIMEOUT_MS);
  });
});
