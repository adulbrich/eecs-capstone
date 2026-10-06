import type { ReactNode } from "react";
import { ErrorBanner } from "./error-banner";
import { SupportEmailLink } from "./support-email-link";

/**
 * The providers `/sign-in` offers, as the `provider` its error URL carries.
 *
 * Better Auth redirects a failed callback to `errorCallbackURL` with the reason
 * in `?error=`, and nothing in that says which provider failed. The remedies
 * differ, so each button names itself in the URL (#579), and Better Auth
 * appends `&error=` to a URL that already has a query
 * (`better-auth/dist/oauth2/errors.mjs`).
 */
export const OAUTH_PROVIDERS = ["onid", "github"] as const;
export type OAuthProvider = (typeof OAUTH_PROVIDERS)[number];

const PROVIDER_NAMES: Record<OAuthProvider, string> = {
  onid: "ONID",
  github: "GitHub",
};

/**
 * `account_not_linked`, which means an unverified row already holds the address
 * and the provider will not link into it. What reaches it differs by provider,
 * and so does the way out.
 *
 * ONID: since #554 the release in `src/lib/auth.ts` takes the address off a
 * credential-only row first, so what is left is a row an admin banned or one
 * another provider is linked to. The emailed code refuses both for the same
 * reasons (`addressProofRefused` in `src/lib/address-proof.ts`), so the way out
 * is a person deciding whose account it is.
 *
 * GitHub has no release (#579 says why), so it also reaches this for a
 * credential-only row from before #576, and for an address GitHub itself has
 * not verified. An emailed code to that address signs in for both, and is the
 * whole remedy: the copy does not say to try GitHub again, because `/sign-in`
 * sends a signed-in visitor to `/profile` and nothing here links GitHub to an
 * existing session.
 *
 * With no provider, an error URL from before #579, the copy promises neither.
 */
const ACCOUNT_NOT_LINKED: Record<OAuthProvider | "unknown", ReactNode> = {
  onid: (
    <>
      You already have an account with this email address that has not been
      verified, and ONID cannot link to it on its own. Contact the capstone
      office at <SupportEmailLink /> and we will sort it out.
    </>
  ),
  github: (
    <>
      You already have an account with this email address, and GitHub cannot
      link to it until the address is verified. Sign in with an emailed code to
      that address instead. If the code does not work, contact the capstone
      office at <SupportEmailLink />.
    </>
  ),
  unknown: (
    <>
      You already have an account with this email address that has not been
      verified, and it cannot be linked on its own. Try signing in with an
      emailed code to that address. If the code does not work, contact the
      capstone office at <SupportEmailLink />.
    </>
  ),
};

/**
 * Copy for the other OAuth failures that need more than the fallback.
 *
 * ONID has no entry of its own. Since Better Auth 1.7 it shares the callback
 * with GitHub, so a token `onidUserInfo` refuses arrives as
 * `unable_to_get_user_info`, the code GitHub's failures use too, and the
 * fallback below already names whichever provider the URL carries. The codes
 * that were ONID's alone on 1.6, `user_info_is_missing` and
 * `email_is_missing`, went with the plugin's own callback (#278).
 */
const OAUTH_ERRORS: Record<string, ReactNode> = {
  signup_disabled: "This account is not permitted to sign up.",
};

function oauthErrorMessage(
  code: string,
  provider: OAuthProvider | undefined
): ReactNode {
  if (code === "account_not_linked") {
    return ACCOUNT_NOT_LINKED[provider ?? "unknown"];
  }
  const failed = provider
    ? `Sign-in through ${PROVIDER_NAMES[provider]} failed.`
    : "Sign-in failed.";
  return (
    OAUTH_ERRORS[code] ?? (
      <>
        {failed} Try again, or sign in with an emailed code. If it keeps
        failing, contact the capstone office at <SupportEmailLink />.
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
 * the one instruction the message gives is one the reader can act on. Every
 * code but `signup_disabled` carries it, which is unreachable in the current
 * configuration.
 */
export function OAuthErrorBanner({
  code,
  provider,
}: {
  code: string;
  provider?: OAuthProvider;
}) {
  return (
    <ErrorBanner className="mt-4">
      {oauthErrorMessage(code, provider)}
    </ErrorBanner>
  );
}
