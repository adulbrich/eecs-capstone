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
  /** Messages of this kind allowed to one address inside the window. */
  limit: number;
  /** How far back sends are counted, in minutes. */
  windowMinutes: number;
}

/**
 * The two messages this app sends about an address nobody has proved they own,
 * metered SEPARATELY, which is the whole reason this union exists.
 *
 * Sharing one allowance was the first design and it was wrong in the attacker's
 * favour. `verification` is the kind a squatter can spend at will, because
 * `sendOnSignIn` mails a fresh link every time they sign in with the password
 * they chose, and that path is deliberately outside the #552 attempt counter
 * (see `isWrongCredential`) because refusing it would lock a real person out of
 * their own way back in. So one sign-up and two sign-ins emptied the hour, and
 * the `duplicate` notice that the real owner's own sign-up should have
 * triggered was silently dropped: the owner saw Better Auth's synthetic success
 * and heard nothing, which is exactly the failure B2 exists to fix.
 *
 * Split, the suppression stops being free. To silence the notice an attacker
 * has to spend the NOTICE budget, and the only way to spend it is to attempt
 * duplicate sign-ups on that address, each of which mails the owner the notice
 * until the budget is gone. They cannot silence it without first sending it.
 */
export type VerificationMailKind = "duplicate" | "verification";

/**
 * Read on every call rather than captured at import, so a test can set a low
 * limit and an operator can retune without a deploy. Both variables are plumbed
 * through `infra/ecs.tf`, the same as `SIGN_IN_SOFT_LIMIT`.
 *
 * Three an hour, for a verification link, is sized against what the honest
 * person actually does, because this cap is the one control here that can lock
 * somebody out of their own account. Their worst legitimate hour is three messages: the link sign-up
 * mailed them, a second from the sign-in that refuses them once the first has
 * expired, and a third from trying again after mistyping something. A fourth in
 * the same hour means the link is not arriving at all, which is a delivery
 * problem that a fourth copy does not fix.
 */
export function verificationMailLimits(
  kind: VerificationMailKind,
  env: NodeJS.ProcessEnv = process.env
): VerificationMailLimits {
  return {
    windowMinutes: Math.round(
      positiveNumber(env.VERIFICATION_MAIL_WINDOW_MINUTES, 60)
    ),
    limit:
      kind === "verification"
        ? Math.round(positiveNumber(env.VERIFICATION_MAIL_LIMIT, 3))
        : // Two rather than three, because the honest case needs far fewer: a
          // person signs up once, and a second attempt after they find nothing
          // in their inbox is the most anybody does before giving up. It is
          // also the budget an attacker has to burn to silence the notice, and
          // burning it sends it.
          Math.round(positiveNumber(env.DUPLICATE_NOTICE_LIMIT, 2)),
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
  limits: VerificationMailLimits
): boolean {
  return sendsInWindow < limits.limit;
}
