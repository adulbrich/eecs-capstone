import type { ReactNode } from "react";
import { SupportEmailLink } from "./support-email-link";

/**
 * The banner `/sign-in` shows when an OAuth callback comes back with an error
 * code. Better Auth redirects a failed callback to `errorCallbackURL` with
 * the reason in `?error=`, and every refusal reaches the browser this way, so
 * this copy is the whole explanation a refused user gets.
 *
 * The office is named as a `mailto:` link inside the alert, not in prose, so
 * the one instruction the message gives is one the reader can act on. Only
 * the codes with no self-service remedy carry it: `account_not_linked` already
 * describes the fix the user performs themselves, and a contact route there
 * invites a support request for something a verification link resolves.
 */
/**
 * Copy for the OAuth failures a user can actually do something about.
 *
 * `account_not_linked` is the one that matters. A student who signed up with a
 * password and never clicked the verification link hits it on their first ONID
 * sign-in, because Better Auth will not merge an authenticated identity into an
 * address nobody has proven. That is the correct refusal, but on its own it is
 * a dead end, so the message says which door to go through instead.
 */
const OAUTH_ERRORS: Record<string, ReactNode> = {
  account_not_linked:
    "You already have an account with this email address that has not been verified. Sign in with your password and verify your email first, then ONID will link to it.",
  email_is_missing: (
    <>
      ONID did not return an email address for your account. Contact the
      capstone office at <SupportEmailLink /> so we can follow up with UIT.
    </>
  ),
  user_info_is_missing: (
    <>
      ONID did not return enough information to sign you in. Try again, and
      contact the capstone office at <SupportEmailLink /> if it keeps happening.
    </>
  ),
  signup_disabled: "This account is not permitted to sign up.",
};

function oauthErrorMessage(code: string): ReactNode {
  return (
    OAUTH_ERRORS[code] ?? (
      <>
        Sign-in through ONID failed. Try again, or use your email and password.
        If it keeps failing, contact the capstone office at <SupportEmailLink />
        .
      </>
    )
  );
}

export function OAuthErrorBanner({ code }: { code: string }) {
  return (
    <p
      className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm"
      role="alert"
    >
      {oauthErrorMessage(code)}
    </p>
  );
}
