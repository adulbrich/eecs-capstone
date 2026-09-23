import {
  createFileRoute,
  Link,
  redirect,
  useSearch,
} from "@tanstack/react-router";
import { z } from "zod";
import { EmailCodeForm } from "#/components/email-code-form";
import {
  OAUTH_PROVIDERS,
  OAuthErrorBanner,
} from "#/components/oauth-error-banner";
import { OAuthSignInButtons } from "#/components/oauth-sign-in-buttons";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { NOINDEX } from "#/lib/social-meta";

const searchSchema = z.object({
  redirect: z.string().optional(),
  // Better Auth redirects a failed OAuth callback to errorCallbackURL with the
  // reason in `error`. Without this the param is not in the route's search
  // schema, so the page renders as if nothing went wrong.
  error: z.string().optional(),
  // Which button failed, carried in its own error URL (#579). `.catch` keeps
  // a hand-edited value from breaking the page: it reads as no provider.
  provider: z.enum(OAUTH_PROVIDERS).optional().catch(undefined),
});

export const Route = createFileRoute("/(auth)/sign-in")({
  head: () => ({ meta: [{ title: pageTitle("Sign In") }, NOINDEX] }),
  validateSearch: searchSchema,
  beforeLoad: async () => {
    const session = await getSession();
    if (session?.user) {
      throw redirect({ to: "/profile" });
    }
  },
  component: SignIn,
});

function SignIn() {
  const {
    redirect: redirectTo,
    error: oauthError,
    provider: failedProvider,
  } = useSearch({
    from: "/(auth)/sign-in",
  });

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
      <div className="island-shell w-full max-w-sm rounded-xl p-8">
        <h1 className="font-semibold text-2xl">Sign in or create an account</h1>
        {oauthError && (
          <OAuthErrorBanner code={oauthError} provider={failedProvider} />
        )}
        <EmailCodeForm redirectTo={redirectTo} />
        <OAuthSignInButtons redirectTo={redirectTo} />
        {/* Worded to be true for a returning visitor too, because this page
            creates accounts: a new address reaches the name step, and a first
            ONID or GitHub sign-in creates one with no step at all (#586). The
            name step carries its own notice, which is the one a new person
            reading only the form will see. A new tab for the reason the name
            step gives: this notice stays on screen through every step of the
            form, and leaving the tab loses a code in progress. */}
        <p className="mt-6 text-muted-foreground text-sm">
          Signing in for the first time creates an account; by doing so you
          agree to the{" "}
          <Link
            className="text-brand-dark underline"
            rel="noopener noreferrer"
            target="_blank"
            to="/privacy"
          >
            privacy policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
