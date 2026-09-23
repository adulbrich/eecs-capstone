import { describe, expect, it } from "vitest";
import { trafficPoolConfig } from "#/lib/_internal/db-pool";
import {
  MAX_EVENT_LAG_MS,
  ROLLUP_SETTLE_MS,
  TRAFFIC_STATEMENT_TIMEOUT_MS,
} from "#/lib/_internal/traffic-timing";

describe("when a day of traffic is final", () => {
  it("settles only after the latest an event can commit, with room for clock skew", () => {
    // An event can wait MAX_EVENT_LAG_MS before its insert starts and the
    // insert can run TRAFFIC_STATEMENT_TIMEOUT_MS; the rollup must wait
    // longer than both, with a margin, or it can close a day under a
    // commit still in flight and lose that event for good.
    expect(MAX_EVENT_LAG_MS + TRAFFIC_STATEMENT_TIMEOUT_MS).toBeLessThanOrEqual(
      ROLLUP_SETTLE_MS / 2
    );
  });

  it("is enforced on the traffic writer's pool", () => {
    expect(trafficPoolConfig("postgres://x").statement_timeout).toBe(
      TRAFFIC_STATEMENT_TIMEOUT_MS
    );
  });
});
