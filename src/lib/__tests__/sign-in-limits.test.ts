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

describe("the verdict", () => {
  it("allows everything below the soft limit", () => {
    for (let failures = 0; failures < limits.softLimit; failures += 1) {
      expect(signInVerdict(failures, limits)).toEqual({ allowed: true });
    }
  });

  it("refuses briefly at the soft limit", () => {
    expect(signInVerdict(limits.softLimit, limits)).toEqual({
      allowed: false,
      retryAfterSeconds: limits.softDelaySeconds,
    });
  });

  it("refuses for longer at the hard limit", () => {
    expect(signInVerdict(limits.hardLimit, limits)).toEqual({
      allowed: false,
      retryAfterSeconds: limits.hardDelaySeconds,
    });
  });

  it("keeps refusing for the longer delay past the hard limit", () => {
    // Not an off-by-one guard for its own sake: the counter is pruned to the
    // window, so a pair can sit above the hard limit for a while, and dropping
    // back to the short delay there would hand an attacker a faster retry the
    // harder they pushed.
    expect(signInVerdict(limits.hardLimit * 10, limits)).toEqual({
      allowed: false,
      retryAfterSeconds: limits.hardDelaySeconds,
    });
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
