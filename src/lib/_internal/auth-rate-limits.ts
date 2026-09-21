import type { BetterAuthRateLimitOptions } from "better-auth";

/**
 * Better Auth's rate limiter, configured rather than inherited.
 *
 * It lives here rather than inline in `src/lib/auth.ts` so a test can read the
 * numbers without importing `#/db`, which throws at import time when
 * DATABASE_URL is unset. See the Vitest section of docs/QUIRKS.md.
 *
 * Every bucket is keyed on the resolved viewer address and the path, and on
 * nothing else: `createRateLimitKey(ip, path)` in
 * `better-auth/dist/api/rate-limiter/index.mjs` takes no configuration. OSU
 * wireless NATs students into a pool of shared public addresses, so one bucket
 * covers however many devices sit behind one pool address, and none of the
 * numbers Better Auth ships were chosen against that. #535, and ADR-0039 for
 * the decision.
 */

/**
 * Better Auth's own global default, restated so an upstream change cannot move
 * it silently, and the window every rule below is counted against.
 *
 * It is NOT the window of every rule Better Auth ships. `getDefaultSpecialRules`
 * has a second rule at 3 per 60 seconds covering `/request-password-reset`,
 * `/send-verification-email` and `/forget-password*`. Those are left alone:
 * they meter outbound email rather than guard a credential, so a shared address
 * is the right thing for them to meter and 3 a minute is not a lockout anybody
 * reaches by hand.
 */
const WINDOW_SECONDS = 10;
const GLOBAL_MAX = 100;

/**
 * What one address may spend per window on a path where no credential is
 * checked.
 *
 * Better Auth's first special rule is 3 per 10 seconds, and its matcher is
 * `startsWith("/sign-in") || startsWith("/sign-up") ||
 * startsWith("/change-password") || startsWith("/change-email")`. That is a
 * brute force rule, and it is the wrong rule for four of the five reachable
 * paths it covers. `/sign-in/oauth2` (ONID) and `/sign-in/social` (GitHub) mint
 * an OAuth state and redirect; the password is typed at Microsoft or GitHub,
 * who run their own defences. `/sign-up/email` creates an account, and
 * `/sign-in/email` is covered by the per-account counter in #552 instead.
 * Behind a NAT pool, 3 per 10 seconds is a lockout the fourth student to click
 * Sign in with ONID hits, caused by nobody's behaviour, and `/sign-up/email`
 * is the path a new student reaches first.
 *
 * 60 is past any number of people clicking at once and short of a script. It
 * is not brute force protection and does not pretend to be: per-address
 * limiting cannot do that behind NAT at any number, which is what #552 is for.
 *
 * `/sign-in/oauth2` keeps a limit rather than being switched off because
 * Better Auth refetches the ONID discovery document from Microsoft on every
 * call, uncached (#553). An unlimited path there is an amplifier pointed at
 * the university's identity provider, and the way it fails is Microsoft
 * throttling us and ONID going down for everybody.
 */
const UNCHECKED_MAX = 60;

/**
 * What one address may spend per window on `/change-password`.
 *
 * Lower than the paths above, and deliberately so. `/change-password` verifies
 * the current password before it writes the new one, so unlike the others it is
 * a real brute force surface: whoever holds a stolen session but not the
 * password guesses here. 3 per 10 seconds still has to go, because a NAT pool
 * address shared by a lecture hall is not a person and would refuse a
 * legitimate change. 20 is high enough that nobody changing their own password
 * meets it and low enough to be worth having until #552 lands.
 */
const CHANGE_PASSWORD_MAX = 20;

const UNCHECKED_RULE = { window: WINDOW_SECONDS, max: UNCHECKED_MAX };

export const authRateLimit: BetterAuthRateLimitOptions = {
  window: WINDOW_SECONDS,
  max: GLOBAL_MAX,
  // Every key is spelled out, with no wildcards, for two reasons. Better Auth
  // takes the first key that matches (`Object.keys(...).find`), so a wildcard
  // beside a specific path makes behaviour depend on declaration order. And
  // its glob treats `*` as "not a slash", so `/sign-in*` matches `/sign-in`
  // alone and never `/sign-in/email`, which is the shape most of the way this
  // gets written down assumes works.
  //
  // `/change-email` is in Better Auth's matcher too and is not listed here,
  // because `user.changeEmail` is not configured (see the comment above
  // `withVerificationLanding` in src/lib/auth.ts) so nothing reaches it. Give
  // it a rule when that changes.
  customRules: {
    // Off, not loosened. `authClient.useSession()` calls this on every page
    // render, which made it 136 of the 139 `/api/auth/*` requests measured in
    // production. It reads a session that the caller already holds a cookie
    // for, so limiting it guards nothing and only decides how early a shared
    // campus address stops being able to render a page.
    "/get-session": false,
    "/change-password": { window: WINDOW_SECONDS, max: CHANGE_PASSWORD_MAX },
    "/sign-in/email": UNCHECKED_RULE,
    "/sign-in/oauth2": UNCHECKED_RULE,
    "/sign-in/social": UNCHECKED_RULE,
    "/sign-up/email": UNCHECKED_RULE,
  },
};

export { CHANGE_PASSWORD_MAX, GLOBAL_MAX, UNCHECKED_MAX };
