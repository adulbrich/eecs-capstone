import type { ReactNode } from "react";
import { ErrorBanner } from "./error-banner";
import { SupportEmailLink } from "./support-email-link";

/**
 * Copy for the OAuth failures a user can actually do something about.
 *
 * `account_not_linked` is the one that matters, and since #554 it is rarer than
 * it was. An unverified password account no longer blocks ONID on its own:
 * `getUserInfo` in `src/lib/auth.ts` takes the address off a credential-only
 * row first. What still reaches this code is an unverified row that another
 * provider is already linked to, which belongs to whoever holds that identity.
 * The copy is unchanged because it is still the right instruction for that
 * case: verify the account, then ONID links. It is a dead end on its own, so
 * the message says which door to go through instead.
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
 * invites a support request for something a verification link resolves, and
 * `signup_disabled` is unreachable in the current configuration.
 */
export function OAuthErrorBanner({ code }: { code: string }) {
  return <ErrorBanner className="mt-4">{oauthErrorMessage(code)}</ErrorBanner>;
}
