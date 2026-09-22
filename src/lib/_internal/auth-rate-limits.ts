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
 * `/send-verification-email` and `/forget-password*`. It reaches nothing here:
 * those paths went with the password (#576) and are 404 through `disabledPaths`
 * in `src/lib/auth.ts`, which answers before the limiter runs.
 *
 * #535 quotes the global default as 100 per 60 seconds. That is what Better
 * Auth's prose docs say and it is wrong for the installed version, which is 100
 * per 10 seconds (`better-auth/dist/context/create-context.mjs`). Do not
 * "correct" this toward the issue.
 */
const WINDOW_SECONDS = 10;
const GLOBAL_MAX = 100;

/**
 * What one address may spend per window on a path where the number protects
 * nothing.
 *
 * `/sign-in/oauth2` (ONID) and `/sign-in/social` (GitHub) mint an OAuth state
 * and redirect, so the password is typed at Microsoft or GitHub. Better Auth's
 * first special rule puts both on 3, which behind a NAT pool address refuses
 * the fourth student since the last lull and protects nothing in exchange. The
 * two code-entry paths take it too, for the reason given beside them below.
 *
 * 60 does not make the refusal impossible, because of the accumulation above:
 * a busy pool address at term start reaches it and then goes quiet for up to a
 * window before it clears. It makes the refusal twenty times rarer and the
 * recovery automatic, which is the whole of what a per-address number can buy
 * here. ADR-0039 has the argument.
 */
const UNCHECKED_MAX = 60;

/**
 * What one address may spend per window on `/email-otp/send-verification-otp`.
 *
 * This is the one path that mails somebody, so it inherits the REASON ADR-0039
 * gave for holding the old `/sign-in/email` down, that a number here is also a
 * cap on mail aimed at an inbox the sender does not own. It does not inherit
 * the number. ADR-0039 set 3 because that limit was the only thing bounding the
 * mail at all; the per-recipient budget in `verification-mail-limits.ts` now
 * bounds what any one inbox can be made to receive whatever this says, which
 * leaves this one job only: making bulk mail to MANY addresses from a single
 * source slow, which a per-recipient cap cannot do.
 *
 * Ten rather than 60 because the population is not a lecture hall. ONID carries
 * about three quarters of sign-in traffic, and with password sign-in gone every
 * OSU person is steered to ONID, so the addresses reaching this path are staff,
 * mentors and industry partners. A NAT pool does not fill up with them at term
 * start the way it fills with students.
 */
const SEND_CODE_MAX = 10;

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
    "/sign-in/oauth2": UNCHECKED_RULE,
    "/sign-in/social": UNCHECKED_RULE,
    // The three email-otp paths (#576). They are listed here rather than left
    // to the plugin because `emailOTP()` registers its own rules at 3 per 60
    // seconds keyed on address and path, which is the shape ADR-0039 rejects,
    // and on the code-entry paths it would refuse the fourth person behind a
    // NAT pool for typing a code correctly. `customRules` is applied after
    // plugin rules and wins, so these are the numbers that take effect.
    "/email-otp/send-verification-otp": {
      window: WINDOW_SECONDS,
      max: SEND_CODE_MAX,
    },
    // Both code-entry paths get the unchecked number despite checking a
    // credential, which looks wrong and is not. `allowedAttempts` bounds one
    // code at three guesses inside the verification record and then deletes it,
    // so the guess budget does not depend on this number at all; a fresh code
    // has to clear the per-recipient send cap first. What this number decides
    // is only whether a shared campus address can still type a code.
    "/email-otp/check-verification-otp": UNCHECKED_RULE,
    "/sign-in/email-otp": UNCHECKED_RULE,
  },
};

/**
 * A path Better Auth's first special rule reaches that is deliberately NOT
 * listed above, so nobody has to re-derive why.
 *
 * `/change-email` keeps the default of 3. Note that "nothing reaches it" would
 * be wrong: the endpoint is mounted whatever `user.changeEmail` says, and a
 * direct call is served and counted. What is true is that no flow in this app
 * calls it, so the default is left in place rather than a number nobody can
 * justify. Give it one when a flow appears.
 *
 * The retired password paths need no entry here or above. They are 404 through
 * `disabledPaths` in `src/lib/auth.ts`, which answers before the limiter runs,
 * so no rule would ever be consulted for them (#576).
 */
export const UNRULED_BY_DESIGN = ["/change-email"] as const;

export { GLOBAL_MAX, SEND_CODE_MAX, UNCHECKED_MAX, WINDOW_SECONDS };
