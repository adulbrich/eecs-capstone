import type { BetterAuthRateLimitOptions } from "better-auth";

/**
 * Better Auth's rate limiter, configured rather than inherited.
 *
 * The argument for these numbers is ADR-0039; the two traps in `customRules`
 * are in the Better Auth section of docs/QUIRKS.md. What lives here is the
 * numbers themselves and which path gets which.
 *
 * It is a module rather than an inline object so a test can read the numbers
 * without importing `#/db`, which throws at import time when DATABASE_URL is
 * unset. See the Vitest section of docs/QUIRKS.md.
 *
 * Two facts every number below depends on.
 *
 * `createRateLimitKey(ip, path)` takes no configuration, so a bucket is one
 * viewer address and a path, and OSU wireless NATs students into a pool of
 * shared addresses. A number here is a cap on volume from one address. It is
 * not, and cannot be, protection for a credential (#552).
 *
 * And a max is NOT a rate. `decideConsume` clears the count only after a gap
 * longer than the window with no ACCEPTED request, and every accepted request
 * pushes that gap out, so a steady trickle well under the nominal rate still
 * accumulates to the max and is then refused until it falls quiet. Read every
 * number below as "this many accepted requests since the last lull", never as
 * "this many per ten seconds". See the Better Auth section of docs/QUIRKS.md.
 */

/**
 * Better Auth's global default, restated so an upstream change cannot move it
 * silently, and the window every rule below is counted against.
 *
 * It is NOT the window of every rule Better Auth ships. `getDefaultSpecialRules`
 * has a second rule at 3 per **60** seconds covering `/request-password-reset`,
 * `/send-verification-email` and `/forget-password*`. Those are left alone:
 * they meter outbound email rather than guard a credential, so a shared address
 * is the right thing for them to meter.
 *
 * #535 quotes the global default as 100 per 60 seconds. That is what Better
 * Auth's prose docs say and it is wrong for the installed version, which is 100
 * per 10 seconds (`better-auth/dist/context/create-context.mjs`). Do not
 * "correct" this toward the issue.
 */
const WINDOW_SECONDS = 10;
const GLOBAL_MAX = 100;

/**
 * What one address may spend per window on a path that checks no credential.
 *
 * `/sign-in/oauth2` (ONID) and `/sign-in/social` (GitHub) mint an OAuth state
 * and redirect, so the password is typed at Microsoft or GitHub; `/sign-up/email`
 * creates an account. Better Auth's first special rule puts all three on 3,
 * which behind a NAT pool address refuses the fourth student since the last
 * lull and protects nothing in exchange.
 *
 * 60 does not make the refusal impossible, because of the accumulation above:
 * a busy pool address at term start reaches it and then goes quiet for up to a
 * window before it clears. It makes the refusal twenty times rarer and the
 * recovery automatic, which is the whole of what a per-address number can buy
 * here. ADR-0039 has the argument.
 */
const UNCHECKED_MAX = 60;

/**
 * What one address may spend per window on `/change-password`.
 *
 * Much lower than the paths above, for two reasons that point the same way.
 *
 * The legitimate call rate is near zero. Sign-in and sign-up have to tolerate a
 * lecture hall arriving at once; nobody changes their own password five times
 * between lulls, so a small number costs a real user nothing.
 *
 * And the call is expensive on purpose. `update-user.mjs` hashes the NEW
 * password BEFORE it verifies the current one, so a wrong guess still pays a
 * full scrypt hash plus a full scrypt verify, measured at about 118 ms of CPU.
 * `sensitiveSessionMiddleware` rejects an unauthenticated call before any of
 * that, so only someone already signed in can spend it, but any student has an
 * account. At 5 that is roughly 6% of a core per key; at 60 it would be most of
 * a core per key, on a fleet of three to four tasks with no WAF in front.
 *
 * This is `/change-password`'s standing control, not a stopgap: #552 covers
 * `/sign-in/email` and does not extend here. It is also the one number left in
 * this file that still guards a credential, which is why it is the one that
 * most wants the shared counter this app does not have (ADR-0039).
 */
const CHANGE_PASSWORD_MAX = 5;

const UNCHECKED_RULE = { window: WINDOW_SECONDS, max: UNCHECKED_MAX };

export const authRateLimit: BetterAuthRateLimitOptions = {
  window: WINDOW_SECONDS,
  max: GLOBAL_MAX,
  customRules: {
    // Off, not loosened. `authClient.useSession()` calls this on every page
    // render, which made it 136 of the 139 `/api/auth/*` requests measured in
    // production. It reads a session the caller already holds a cookie for, so
    // limiting it guards nothing and only decides how early a shared campus
    // address stops being able to render a page.
    "/get-session": false,
    "/change-password": { window: WINDOW_SECONDS, max: CHANGE_PASSWORD_MAX },
    "/sign-in/oauth2": UNCHECKED_RULE,
    "/sign-in/social": UNCHECKED_RULE,
    "/sign-up/email": UNCHECKED_RULE,
  },
};

/**
 * Two paths Better Auth's first special rule reaches that are deliberately NOT
 * listed above, so nobody has to re-derive why.
 *
 * `/sign-in/email` keeps the default of 3. Raising it would be consistent with
 * everything else here, and it was raised and then reverted:
 * `emailVerification.sendOnSignIn` mails a fresh verification link on every
 * successful sign-in to an unverified account, and anyone can register an
 * address they do not own with a password they choose. So this number is also
 * what throttles verification mail aimed at a stranger's inbox, and 60 would
 * make that twenty times easier (#554). It throttles rather than bounds: the
 * counter is per task and currently per CloudFront edge address, so the real
 * figure across the fleet is a multiple of 3 and not 3. The campus cost is
 * accepted because password sign-in here is a few dozen staff and mentors
 * rather than a lecture hall, and ONID is what students use. Raise this only
 * once #554 meters the send, and #552 is the control that should carry it.
 *
 * `/change-email` also matches and also keeps the default. Note that "nothing
 * reaches it" would be wrong: the endpoint is mounted whatever
 * `user.changeEmail` says, and a direct call is served and counted. What is
 * true is that no flow in this app calls it, so the default is left in place
 * rather than a number nobody can justify. Give it one when a flow appears.
 * See the comment above `withVerificationLanding` in src/lib/auth.ts.
 */
export const UNRULED_BY_DESIGN = ["/sign-in/email", "/change-email"] as const;

export { CHANGE_PASSWORD_MAX, GLOBAL_MAX, UNCHECKED_MAX, WINDOW_SECONDS };
