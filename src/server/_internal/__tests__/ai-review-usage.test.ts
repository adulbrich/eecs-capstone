import { describe, expect, it } from "vitest";
import { limitVerdict, reviewLimits } from "#/lib/ai-review-limits";

const LIMITS = { perHour: 10, perDay: 40 };

function counts(inHour: number, inDay: number) {
  return {
    inHour,
    inDay,
    hourResetsInMinutes: 12,
    dayResetsInMinutes: 300,
  };
}

describe("reviewLimits", () => {
  it("reads both windows from the environment", () => {
    expect(
      reviewLimits({
        AI_REVIEW_LIMIT_PER_HOUR: "3",
        AI_REVIEW_LIMIT_PER_DAY: "5",
      })
    ).toEqual({ perHour: 3, perDay: 5 });
  });

  it("falls back to the shipped defaults", () => {
    expect(reviewLimits({})).toEqual({ perHour: 10, perDay: 40 });
  });
});

describe("limitVerdict", () => {
  it("allows a call below both limits", () => {
    expect(limitVerdict(counts(9, 39), LIMITS)).toBeNull();
  });

  it("blocks at the hourly limit, not one past it", () => {
    // The count is of calls already made, so reaching the limit means the next
    // one would be the eleventh.
    expect(limitVerdict(counts(10, 20), LIMITS)).toMatch(/for this hour/);
  });

  it("blocks on the daily limit even when the hour has room", () => {
    expect(limitVerdict(counts(0, 40), LIMITS)).toMatch(/for today/);
  });

  it("tells the user when the window reopens", () => {
    expect(limitVerdict(counts(10, 20), LIMITS)).toContain("about 12 minutes");
  });

  it("rounds a long wait to hours rather than reporting 300 minutes", () => {
    const verdict = limitVerdict(
      { inHour: 0, inDay: 40, hourResetsInMinutes: 0, dayResetsInMinutes: 300 },
      LIMITS
    );
    expect(verdict).toContain("about 5 hours");
  });

  it("does not say zero minutes when the window is about to reopen", () => {
    const verdict = limitVerdict(
      { inHour: 10, inDay: 20, hourResetsInMinutes: 0, dayResetsInMinutes: 0 },
      LIMITS
    );
    expect(verdict).toContain("in a minute");
  });
});
