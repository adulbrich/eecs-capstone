import type { OAuthProvider } from "#/components/oauth-error-banner";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";

/**
 * Where a refused sign-in lands: `/sign-in`, naming the provider, so
 * `OAuthErrorBanner` can give the remedy for that provider (#579). Both
 * buttons need one. Without it Better Auth sends a refusal to its own bare
 * error page, which is where GitHub's went until #579.
 */
const errorCallbackURL = (provider: OAuthProvider) =>
  `/sign-in?provider=${provider}`;

/** The ONID and GitHub buttons on `/sign-in`, below the emailed code form. */
export function OAuthSignInButtons({ redirectTo }: { redirectTo?: string }) {
  return (
    <>
      <Button
        className="mt-3 w-full"
        onClick={() =>
          authClient.signIn.oauth2({
            providerId: "onid",
            callbackURL: redirectTo ?? "/",
            errorCallbackURL: errorCallbackURL("onid"),
          })
        }
        type="button"
      >
        Continue with ONID
      </Button>
      <Button
        className="mt-3 w-full"
        onClick={() =>
          authClient.signIn.social({
            provider: "github",
            callbackURL: redirectTo ?? "/",
            errorCallbackURL: errorCallbackURL("github"),
          })
        }
        type="button"
        variant="outline"
      >
        Continue with GitHub
      </Button>
    </>
  );
}
