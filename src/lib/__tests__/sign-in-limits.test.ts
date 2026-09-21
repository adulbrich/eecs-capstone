import { describe, expect, it } from "vitest";
import {
  type SignInLimits,
  signInLimits,
  signInVerdict,
  tooManyAttemptsMessage,
} from "../sign-in-limits";

const limits: SignInLimits = {
  windowMinutes: 15,
  softLimit: 5,
  softDelaySeconds: 60,
  hardLimit: 10,
  hardDelaySeconds: 900,
};

const NOW = new Date("2026-09-21T12:00:00Z");
const secondsAgo = (seconds: number) =>
  new Date(NOW.getTime() - seconds * 1000);

describe("the verdict", () => {
  it("allows everything below the soft limit", () => {
    for (let failures = 0; failures < limits.softLimit; failures += 1) {
      expect(
        signInVerdict({ count: failures, lastAt: secondsAgo(1) }, limits, NOW)
      ).toEqual({ allowed: true });
    }
  });

  it("allows a pair that has never failed", () => {
    expect(signInVerdict({ count: 0, lastAt: null }, limits, NOW)).toEqual({
      allowed: true,
    });
  });

  it("refuses at the soft limit, for the soft delay", () => {
    expect(
      signInVerdict({ count: limits.softLimit, lastAt: NOW }, limits, NOW)
    ).toEqual({ allowed: false, retryAfterSeconds: limits.softDelaySeconds });
  });

  it("refuses at the hard limit, for the longer delay", () => {
    expect(
      signInVerdict({ count: limits.hardLimit, lastAt: NOW }, limits, NOW)
    ).toEqual({ allowed: false, retryAfterSeconds: limits.hardDelaySeconds });
  });

  it("keeps the longer delay past the hard limit", () => {
    expect(
      signInVerdict({ count: limits.hardLimit * 10, lastAt: NOW }, limits, NOW)
    ).toEqual({ allowed: false, retryAfterSeconds: limits.hardDelaySeconds });
  });

  // The regression this shape exists for. Deciding on the count alone left the
  // delay feeding only the message, so a pair stayed refused until its failures
  // aged out of the window: the message said "about 1 minute" and the refusal
  // lasted up to fifteen. These two cases are what make the delay a real
  // duration rather than a decoration.
  it("counts the delay down as it elapses", () => {
    expect(
      signInVerdict(
        { count: limits.softLimit, lastAt: secondsAgo(20) },
        limits,
        NOW
      )
    ).toEqual({
      allowed: false,
      retryAfterSeconds: limits.softDelaySeconds - 20,
    });
  });

  it("allows again once the delay has passed, while the count still stands", () => {
    expect(
      signInVerdict(
        {
          count: limits.softLimit,
          lastAt: secondsAgo(limits.softDelaySeconds),
        },
        limits,
        NOW
      )
    ).toEqual({ allowed: true });
  });
});

describe("the configured numbers", () => {
  it("falls back to the defaults when nothing is set", () => {
    expect(signInLimits({} as NodeJS.ProcessEnv)).toEqual(limits);
  });

  it("reads every variable from the environment", () => {
    expect(
      signInLimits({
        SIGN_IN_ATTEMPT_WINDOW_MINUTES: "30",
        SIGN_IN_SOFT_LIMIT: "3",
        SIGN_IN_SOFT_DELAY_SECONDS: "10",
        SIGN_IN_HARD_LIMIT: "6",
        SIGN_IN_HARD_DELAY_SECONDS: "120",
      } as NodeJS.ProcessEnv)
    ).toEqual({
      windowMinutes: 30,
      softLimit: 3,
      softDelaySeconds: 10,
      hardLimit: 6,
      hardDelaySeconds: 120,
    });
  });

  it.each(["0", "-1", "", "  ", "nonsense", "NaN"])(
    "ignores %o rather than disabling the control or refusing everyone",
    (value) => {
      // A limit of 0 would refuse every sign-in on the app, and a negative
      // window would count nothing and silently turn the control off. An
      // operator typo in a task definition should reach neither.
      const parsed = signInLimits({
        SIGN_IN_SOFT_LIMIT: value,
        SIGN_IN_ATTEMPT_WINDOW_MINUTES: value,
      } as NodeJS.ProcessEnv);
      expect(parsed.softLimit).toBe(limits.softLimit);
      expect(parsed.windowMinutes).toBe(limits.windowMinutes);
    }
  );
});

describe("the refusal message", () => {
  // It names a duration rather than reusing "invalid email or password". That
  // is safe only because the counter also counts addresses with no account, so
  // a refusal says how often the caller tried and nothing about whether the
  // account exists. See the docblock on `tooManyAttemptsMessage`.
  it("says seconds under a minute", () => {
    expect(tooManyAttemptsMessage(30)).toContain("30 seconds");
  });

  it("says minutes at or above one, without a plural on exactly one", () => {
    expect(tooManyAttemptsMessage(60)).toContain("1 minute");
    expect(tooManyAttemptsMessage(60)).not.toContain("1 minutes");
    expect(tooManyAttemptsMessage(900)).toContain("15 minutes");
  });

  it("never reveals whether the account exists", () => {
    const message = tooManyAttemptsMessage(60);
    for (const leak of ["not found", "no account", "unknown", "exists"]) {
      expect(message.toLowerCase()).not.toContain(leak);
    }
  });
});
