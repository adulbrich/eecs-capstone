import { describe, expect, it } from "vitest";
import {
  verificationMailAllowed,
  verificationMailLimits,
} from "#/lib/verification-mail-limits";

// The pure half of the cap on verification mail (#554, piece D). The queries
// are covered by `verification-sends.integration.test.ts`; this file exists so
// the numbers can be pinned without a database, the same split as
// `sign-in-limits.test.ts`.

describe("verificationMailLimits", () => {
  it("defaults to three an hour", () => {
    expect(verificationMailLimits({})).toEqual({
      limit: 3,
      windowMinutes: 60,
    });
  });

  it("takes both numbers from the environment", () => {
    expect(
      verificationMailLimits({
        VERIFICATION_MAIL_LIMIT: "5",
        VERIFICATION_MAIL_WINDOW_MINUTES: "30",
      })
    ).toEqual({ limit: 5, windowMinutes: 30 });
  });

  it.each([
    ["zero", "0"],
    ["a negative", "-1"],
    ["a word", "lots"],
    ["blank", ""],
  ])("falls back rather than accepting %s", (_label, value) => {
    // A limit of 0 would refuse every verification link on the app and lock
    // out every new account, which is worse than an operator's typo being
    // ignored. A window of 0 reaches Postgres as make_interval and would
    // count nothing, silently disabling the cap.
    expect(
      verificationMailLimits({
        VERIFICATION_MAIL_LIMIT: value,
        VERIFICATION_MAIL_WINDOW_MINUTES: value,
      })
    ).toEqual({ limit: 3, windowMinutes: 60 });
  });

  it("rounds a fractional window, because make_interval errors on one", () => {
    expect(
      verificationMailLimits({ VERIFICATION_MAIL_WINDOW_MINUTES: "59.6" })
        .windowMinutes
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
    // Three is what an honest person's worst hour costs: the sign-up link, the
    // one a refused sign-in mails once that has expired, and one more after a
    // mistype. The fourth is refused.
    expect(verificationMailAllowed(3, limits)).toBe(false);
    expect(verificationMailAllowed(4, limits)).toBe(false);
  });
});
