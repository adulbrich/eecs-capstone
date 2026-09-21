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
 * numbers Better Auth ships were chosen against that. #535.
 */

/**
 * Better Auth's own global default, restated so an upstream change cannot move
 * it silently. Ten seconds is the window every rule below is counted against,
 * including the ones Better Auth applies to the mail paths, which are left
 * alone: they meter outbound email rather than guard a credential, and a
 * shared address is the right thing for them to meter.
 */
const WINDOW_SECONDS = 10;
const GLOBAL_MAX = 100;

/**
 * What one address may spend on a sign-in path per window.
 *
 * Better Auth defaults anything under `/sign-in` to 3, which is a brute force
 * rule, and it is the wrong rule for two of the three paths it covers.
 * `/sign-in/oauth2` (ONID) and `/sign-in/social` (GitHub) mint a state and
 * redirect; the password is typed at Microsoft or GitHub, who run their own
 * defences. Behind a NAT pool, 3 per 10 seconds is a lockout that the fourth
 * student to click Sign in with ONID hits, caused by nobody's behaviour.
 *
 * 60 is past any number of people clicking at once and short of a script. It
 * is not brute force protection and does not pretend to be: per-address
 * limiting cannot do that behind NAT at any number. The control that survives
 * a shared address is a per-account attempt counter, which is tracked
 * separately.
 *
 * `/sign-in/oauth2` keeps a limit rather than being switched off because
 * Better Auth refetches the ONID discovery document from Microsoft on every
 * call, uncached (`plugins/generic-oauth/routes.mjs`). An unlimited path there
 * is an amplifier pointed at the university's identity provider, and the way
 * it fails is Microsoft throttling us and ONID going down for everybody.
 */
const SIGN_IN_MAX = 60;

const SIGN_IN_RULE = { window: WINDOW_SECONDS, max: SIGN_IN_MAX };

export const authRateLimit: BetterAuthRateLimitOptions = {
  window: WINDOW_SECONDS,
  max: GLOBAL_MAX,
  // Every key is spelled out, with no wildcards, for two reasons. Better Auth
  // takes the first key that matches (`Object.keys(...).find`), so a wildcard
  // beside a specific path makes behaviour depend on declaration order. And
  // its glob treats `*` as "not a slash", so `/sign-in*` matches `/sign-in`
  // alone and never `/sign-in/email`, which is the shape most of the way this
  // gets written down assumes works.
  customRules: {
    // Off, not loosened. `authClient.useSession()` calls this on every page
    // render, which made it 136 of the 139 `/api/auth/*` requests measured in
    // production. It reads a session that the caller already holds a cookie
    // for, so limiting it guards nothing and only decides how early a shared
    // campus address stops being able to render a page.
    "/get-session": false,
    "/sign-in/email": SIGN_IN_RULE,
    "/sign-in/oauth2": SIGN_IN_RULE,
    "/sign-in/social": SIGN_IN_RULE,
  },
};

export { GLOBAL_MAX, SIGN_IN_MAX, WINDOW_SECONDS };
