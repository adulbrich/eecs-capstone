import { describe, expect, it } from "vitest";
import { isoDay, resolveRange } from "#/lib/report-range";

const NOW = new Date("2026-09-22T18:00:00Z");

describe("resolveRange", () => {
  it("defaults to the last thirty days", () => {
    expect(resolveRange({}, NOW)).toEqual({
      from: "2026-08-23",
      to: "2026-09-22",
    });
  });

  it("keeps a range the URL names", () => {
    expect(resolveRange({ from: "2026-01-01", to: "2026-01-31" }, NOW)).toEqual(
      { from: "2026-01-01", to: "2026-01-31" }
    );
  });

  it("puts a backwards range in order rather than failing", () => {
    expect(resolveRange({ from: "2026-02-01", to: "2026-01-01" }, NOW)).toEqual(
      { from: "2026-01-01", to: "2026-02-01" }
    );
  });
});

describe("isoDay", () => {
  it("reads the UTC day, which is the known gap the docblock names", () => {
    // 5pm Pacific on the 22nd is already the 23rd in UTC.
    expect(isoDay(0, new Date("2026-09-23T00:30:00Z"))).toBe("2026-09-23");
  });
});
