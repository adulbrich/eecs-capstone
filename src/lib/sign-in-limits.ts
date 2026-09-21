// Shared, dependency-free definitions for the sign-in attempt limit.
//
// This file must import nothing. The decision logic lives here rather than
// beside the queries in `server/_internal/sign-in-attempts.ts` so a unit test
// can reach it without pulling in `#/db`, which throws at import time when
// DATABASE_URL is unset. CI has no .env, so a pure function behind that import
// is a test that only passes on a developer's machine. Same split as
// `ai-review-limits.ts` and `server/_internal/ai-review-usage.ts`.

/**
 * What the app does that Better Auth's own rate limiter cannot.
 *
 * `createRateLimitKey(ip, path)` takes no configuration, so every limit Better
 * Auth applies is per address, and OSU wireless NATs students into a pool of
 * shared addresses. A per-address number therefore cannot protect a credential
 * at any value, which is what ADR-0039 concluded and why `/sign-in/email` was
 * left on the framework default rather than raised with everything around it.
 *
 * This counts per ACCOUNT instead, which is what OWASP recommends: "The counter
 * of failed logins should be associated with the account itself, rather than
 * the source IP address, in order to prevent an attacker from making login
 * attempts from a large number of different IP addresses."
 *
 * It pairs the account with the address rather than using the account alone,
 * because OWASP's next sentence is the trap: "care must be taken to prevent it
 * from being used to cause a denial of service by locking out other users'
 * accounts." Keyed on the account alone, anyone who knows your address can lock
 * you out of it. Keyed on the pair, an attacker on another network cannot, and
 * behind campus NAT the pair is still tens of devices rather than the internet.
 */
export interface SignInLimits {
  /** How long THAT refusal lasts, in seconds. */
  hardDelaySeconds: number;
  /** Failures in the window before the longer refusal. */
  hardLimit: number;
  /** How long that refusal lasts, in seconds. */
  softDelaySeconds: number;
  /** Failures in the window before the first, short refusal. */
  softLimit: number;
  /** How far back failures are counted, in minutes. */
  windowMinutes: number;
}

/**
 * Read on every call rather than captured at import, so a test can set a low
 * limit and an operator can retune without a deploy. Every variable is plumbed
 * through `infra/ecs.tf`, the same as `AI_REVIEW_LIMIT_PER_HOUR`.
 *
 * The defaults are deliberately forgiving. A person who has genuinely forgotten
 * their password tries a handful of times, so five is already past normal
 * fumbling, and the first refusal is a minute rather than anything a real user
 * would experience as a lockout. Nothing here is ever permanent: there is no
 * state to clear, no admin action, and the `banned` column is untouched,
 * because a ban is a decision a person makes and this is not.
 */
export function signInLimits(
  env: NodeJS.ProcessEnv = process.env
): SignInLimits {
  return {
    windowMinutes: Math.round(
      positiveNumber(env.SIGN_IN_ATTEMPT_WINDOW_MINUTES, 15)
    ),
    softLimit: positiveNumber(env.SIGN_IN_SOFT_LIMIT, 5),
    softDelaySeconds: positiveNumber(env.SIGN_IN_SOFT_DELAY_SECONDS, 60),
    hardLimit: positiveNumber(env.SIGN_IN_HARD_LIMIT, 10),
    hardDelaySeconds: positiveNumber(env.SIGN_IN_HARD_DELAY_SECONDS, 900),
  };
}

/**
 * Falls back rather than throwing, and rejects zero and negatives as well as
 * NaN. `windowMinutes` is rounded on top of this, because it reaches Postgres
 * as `make_interval(mins => ...)`, which errors on a fraction, and the swallow
 * around the counter would turn that error into a silently disabled control. An operator typo in a task definition should not be able to set a limit
 * of 0, which would refuse every sign-in on the app, nor a negative window,
 * which would count nothing and silently disable the control. Both failure
 * directions are worse than the default.
 */
function positiveNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** What the caller should do with an attempt, given the failures behind it. */
export type SignInVerdict =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

/** What a pair's recent history looks like, as the query returns it. */
export interface RecentFailures {
  /** Failures inside the window. */
  count: number;
  /** When the newest of them happened, or null when there are none. */
  lastAt: Date | null;
}

/**
 * Decides on the failure history alone, so the caller owns every query and this
 * stays testable without one.
 *
 * The delay is measured from the NEWEST failure rather than from the oldest, so
 * `softDelaySeconds` is a real duration that a person waits out. An earlier
 * version decided on the count alone and left the delay feeding only the
 * message: a pair was then refused until its failures aged out of the window,
 * which meant the message said "about 1 minute" while the refusal lasted up to
 * `windowMinutes`. Telling somebody the wrong number is worse than telling them
 * nothing, so the two are now the same number by construction.
 *
 * A refused attempt never reaches the endpoint, so it writes no row and does
 * not push `lastAt` forward. Without that, every retry would restart the delay
 * and the soft limit would be a permanent lockout rather than a throttle.
 *
 * Once past the soft limit the effect is one attempt per `softDelaySeconds`,
 * and past the hard limit one per `hardDelaySeconds`, until the window empties.
 */
export function signInVerdict(
  recent: RecentFailures,
  limits: SignInLimits = signInLimits(),
  now: Date = new Date()
): SignInVerdict {
  if (recent.lastAt === null || recent.count < limits.softLimit) {
    return { allowed: true };
  }
  const delaySeconds =
    recent.count >= limits.hardLimit
      ? limits.hardDelaySeconds
      : limits.softDelaySeconds;
  const remainingMs =
    recent.lastAt.getTime() + delaySeconds * 1000 - now.getTime();
  if (remainingMs <= 0) {
    return { allowed: true };
  }
  return {
    allowed: false,
    retryAfterSeconds: Math.ceil(remainingMs / 1000),
  };
}

/**
 * The refusal a person sees.
 *
 * Says plainly that there were too many attempts and when to come back, rather
 * than reusing Better Auth's "invalid email or password". Hiding the refusal
 * behind that message would leak nothing either, but it would leave somebody
 * who mistyped their password five times staring at a message that says their
 * password is wrong when the problem is that they are being throttled.
 *
 * It is safe to be explicit BECAUSE the counter also counts addresses that have
 * no account. Refusing tells the caller how many times they themselves have
 * tried, which they already know, and nothing about whether the account exists.
 * If this is ever changed to skip unknown addresses, this message has to become
 * the generic one in the same commit.
 */
export function tooManyAttemptsMessage(retryAfterSeconds: number): string {
  const minutes = Math.ceil(retryAfterSeconds / 60);
  const when =
    retryAfterSeconds < 60
      ? `${Math.ceil(retryAfterSeconds)} seconds`
      : `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `Too many sign-in attempts for this account. Try again in about ${when}, or reset your password.`;
}

/** Stands in for the viewer address when Better Auth cannot resolve one. */
export const UNRESOLVED_IP = "unresolved";
