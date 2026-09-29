import {
  createFileRoute,
  Link,
  redirect,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { EmailCodeForm, type Step } from "#/components/email-code-form";
import {
  OAUTH_PROVIDERS,
  OAuthErrorBanner,
} from "#/components/oauth-error-banner";
import { OAuthSignInButtons } from "#/components/oauth-sign-in-buttons";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { sameOriginPath } from "#/lib/same-origin-path";
import { NOINDEX } from "#/lib/social-meta";

export const searchSchema = z.object({
  // A path on this site or nothing, so the code form's navigate and the
  // OAuth buttons' callbackURL both receive a checked value (#702).
  redirect: z.string().optional().transform(sameOriginPath).catch(undefined),
  // Better Auth redirects a failed OAuth callback to errorCallbackURL with the
  // reason in `error`. Without this the param is not in the route's search
  // schema, so the page renders as if nothing went wrong.
  error: z.string().optional().catch(undefined),
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
  const [step, setStep] = useState<Step>("address");

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
      <div className="island-shell w-full max-w-sm rounded-xl p-8">
        <h1 className="font-semibold text-2xl">Sign in or create an account</h1>
        {oauthError && (
          <OAuthErrorBanner code={oauthError} provider={failedProvider} />
        )}
        <EmailCodeForm onStepChange={setStep} redirectTo={redirectTo} />
        {/* Only on the address step (#611). Past it the form's own submit is
            the one primary action, and "Use a different address" is the way
            back to these: on the code step always, for somebody whose code
            never arrives, and on the name step once a redeem is refused. */}
        {step === "address" && <OAuthSignInButtons redirectTo={redirectTo} />}
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
