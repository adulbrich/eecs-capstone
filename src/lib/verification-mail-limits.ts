// Shared, dependency-free definitions for the per-recipient cap on sign-in
// codes (#554, #576).
//
// This file must import nothing, the same split as `ai-review-limits.ts`: the
// decision lives here so a unit test can reach it without pulling in `#/db`,
// which throws at import time when DATABASE_URL is unset, and the queries live
// in `server/_internal/verification-sends.ts`.

/**
 * Why a cap exists at all.
 *
 * It is the brute force control on the emailed code, not politeness. Better
 * Auth bounds one code at `allowedAttempts` guesses, but `resendStrategy:
 * "rotate"` resets that counter on every resend, so without a cap on sends the
 * three-guess bound means nothing: an attacker asks for another code. There is
 * no per-account attempt counter behind it any more, because there is no
 * password to count against (#576). Per-address rate limiting cannot do this
 * job either, for the reason ADR-0039 gives, that campus NAT makes the sender's
 * address meaningless, so this counts per RECIPIENT.
 *
 * It was built (#554) to cap verification links and a duplicate-sign-up notice
 * aimed at a stranger's inbox, and both went with the password. ADR-0046 is the
 * decision and records why the kinds were metered apart.
 */
export interface VerificationMailLimits {
  /** Messages of this kind allowed to one address inside the window. */
  limit: number;
  /** How far back sends are counted, in minutes. */
  windowMinutes: number;
}

/**
 * What a row in `verification_sends` counts. One kind is left; the union and
 * the column stay because kinds are metered apart (ADR-0046), and a second
 * message about an address would be a second kind rather than a share of this
 * one's budget.
 */
export type VerificationMailKind = "sign-in-code";

/**
 * Read on every call rather than captured at import, so a test can set a low
 * limit and an operator can retune without a deploy. Both variables are
 * plumbed through `infra/ecs.tf`.
 *
 * Five an hour, sized from the person it can lock out rather than from the
 * attacker, because running out locks somebody out of the app entirely. The
 * honest worst hour is a code that does not arrive, a second, and a third after
 * mistyping the second past its three guesses. Five leaves room for that and
 * still bounds an attacker to fifteen guesses an hour against a six digit
 * space.
 */
export function verificationMailLimits(
  env: NodeJS.ProcessEnv = process.env
): VerificationMailLimits {
  return {
    windowMinutes: Math.round(
      positiveNumber(env.VERIFICATION_MAIL_WINDOW_MINUTES, 60)
    ),
    limit: Math.round(positiveNumber(env.SIGN_IN_CODE_LIMIT, 5)),
  };
}

/**
 * Falls back rather than throwing, and rejects zero and negatives as well as
 * NaN. Both values are rounded: `windowMinutes` reaches Postgres as
 * `make_interval(mins => ...)`, which errors on a fraction, and a fractional
 * limit would compare against a count in a way nobody reading the variable
 * would predict. An operator typo should not be able to set a limit of 0, which
 * would stop every sign-in code on the app and lock out everyone without ONID.
 */
function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Whether one more message may go to an address with this much recent history. */
export function verificationMailAllowed(
  sendsInWindow: number,
  limits: VerificationMailLimits
): boolean {
  return sendsInWindow < limits.limit;
}
