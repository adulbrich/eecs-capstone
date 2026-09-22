// Shared, dependency-free definitions for the cap on verification mail (#554).
//
// This file must import nothing, the same split as `sign-in-limits.ts` and
// `ai-review-limits.ts`: the decision lives here so a unit test can reach it
// without pulling in `#/db`, which throws at import time when DATABASE_URL is
// unset, and the queries live in `server/_internal/verification-sends.ts`.

/**
 * Why a cap exists at all.
 *
 * Sign-up is open and `emailVerification.sendOnSignIn` is true, so anyone can
 * register an address they do not own and then mail its real owner a fresh
 * verification link on every sign-in with the password they chose. Before this,
 * the only thing bounding that was Better Auth's rate limit on
 * `/sign-in/email`, which ADR-0039 left on the framework default for exactly
 * that reason: it is a per-address limit doing duty as a per-recipient mail cap,
 * which is the wrong shape twice over, because the sender's address is not the
 * recipient's and campus NAT makes the sender's address meaningless anyway.
 *
 * This counts per RECIPIENT, which is the thing being harmed. It bounds the
 * duplicate-sign-up notice as well as the verification link, because both land
 * in the same inbox and an attacker can trigger either.
 */
export interface VerificationMailLimits {
  /** Messages allowed to one address inside the window. */
  limit: number;
  /** How far back sends are counted, in minutes. */
  windowMinutes: number;
}

/**
 * Read on every call rather than captured at import, so a test can set a low
 * limit and an operator can retune without a deploy. Both variables are plumbed
 * through `infra/ecs.tf`, the same as `SIGN_IN_SOFT_LIMIT`.
 *
 * Three an hour is sized against what the honest person actually does, because
 * this cap is the one control here that can lock somebody out of their own
 * account. Their worst legitimate hour is three messages: the link sign-up
 * mailed them, a second from the sign-in that refuses them once the first has
 * expired, and a third from trying again after mistyping something. A fourth in
 * the same hour means the link is not arriving at all, which is a delivery
 * problem that a fourth copy does not fix.
 */
export function verificationMailLimits(
  env: NodeJS.ProcessEnv = process.env
): VerificationMailLimits {
  return {
    windowMinutes: Math.round(
      positiveNumber(env.VERIFICATION_MAIL_WINDOW_MINUTES, 60)
    ),
    limit: Math.round(positiveNumber(env.VERIFICATION_MAIL_LIMIT, 3)),
  };
}

/**
 * Falls back rather than throwing, and rejects zero and negatives as well as
 * NaN. Both values are rounded: `windowMinutes` reaches Postgres as
 * `make_interval(mins => ...)`, which errors on a fraction, and a fractional
 * limit would compare against a count in a way nobody reading the variable
 * would predict. An operator typo should not be able to set a limit of 0, which
 * would stop every verification link on the app and lock out every new account.
 */
function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Whether one more message may go to an address with this much recent history. */
export function verificationMailAllowed(
  sendsInWindow: number,
  limits: VerificationMailLimits = verificationMailLimits()
): boolean {
  return sendsInWindow < limits.limit;
}
