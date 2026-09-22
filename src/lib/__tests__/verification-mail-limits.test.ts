import { describe, expect, it } from "vitest";
import {
  verificationMailAllowed,
  verificationMailLimits,
} from "#/lib/verification-mail-limits";

// The pure half of the per-recipient cap on sign-in codes (#554, #576). The
// queries are covered by `verification-sends.integration.test.ts`; this file
// exists so the numbers can be pinned without a database.

describe("verificationMailLimits", () => {
  it("defaults a sign-in code to five an hour", () => {
    expect(verificationMailLimits({})).toEqual({
      limit: 5,
      windowMinutes: 60,
    });
  });

  it("takes both numbers from the environment", () => {
    expect(
      verificationMailLimits({
        SIGN_IN_CODE_LIMIT: "8",
        VERIFICATION_MAIL_WINDOW_MINUTES: "30",
      })
    ).toEqual({ limit: 8, windowMinutes: 30 });
  });

  it.each([
    ["zero", "0"],
    ["a negative", "-1"],
    ["a word", "lots"],
    ["blank", ""],
    // Rounds to zero, so it must be caught after rounding, not before.
    ["a fraction under a half", "0.4"],
  ])("falls back rather than accepting %s", (_label, value) => {
    // A limit of 0 would refuse every sign-in code on the app and lock out
    // everyone without ONID, which is worse than an operator's typo being
    // ignored. A window of 0 reaches Postgres as make_interval and would
    // count nothing, silently disabling the cap.
    expect(
      verificationMailLimits({
        SIGN_IN_CODE_LIMIT: value,
        VERIFICATION_MAIL_WINDOW_MINUTES: value,
      })
    ).toEqual({ limit: 5, windowMinutes: 60 });
  });

  it("rounds a fractional window, because make_interval errors on one", () => {
    expect(
      verificationMailLimits({
        VERIFICATION_MAIL_WINDOW_MINUTES: "59.6",
      }).windowMinutes
    ).toBe(60);
  });
});

describe("verificationMailAllowed", () => {
  const limits = { limit: 3, windowMinutes: 60 };

  it("allows a recipient who has had fewer than the limit", () => {
    expect(verificationMailAllowed(0, limits)).toBe(true);
    expect(verificationMailAllowed(2, limits)).toBe(true);
  });

  it("refuses at the limit, not one past it", () => {
    expect(verificationMailAllowed(3, limits)).toBe(false);
    expect(verificationMailAllowed(4, limits)).toBe(false);
  });
});
