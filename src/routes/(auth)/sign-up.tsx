import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { EmailCodeForm } from "#/components/email-code-form";
import { Button } from "#/components/ui/button";
import { authClient } from "#/lib/auth-client";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { NOINDEX } from "#/lib/social-meta";

export const Route = createFileRoute("/(auth)/sign-up")({
  head: () => ({ meta: [{ title: pageTitle("Sign Up") }, NOINDEX] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (session?.user) {
      throw redirect({ to: "/profile" });
    }
  },
  component: SignUp,
});

function SignUp() {
  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
      <div className="island-shell w-full max-w-sm rounded-xl p-8">
        <h1 className="font-semibold text-2xl">Create an account</h1>
        {/* The same component the sign-in page renders, behaving identically.
            Two pages that answered one address differently would together say
            whether it has an account, which is the enumeration the send
            endpoint is careful not to leak. */}
        <EmailCodeForm />
        <Button
          className="mt-3 w-full"
          onClick={() =>
            authClient.signIn.oauth2({
              providerId: "onid",
              // Explicit, unlike the GitHub button below. signIn.social and
              // signIn.oauth2 are different code paths, and the oauth2 callback
              // handler calls .toString() on whatever callbackURL the state
              // carried, so an absent one is not obviously safe. Cheaper to
              // pass it than to prove it.
              callbackURL: "/",
              errorCallbackURL: "/sign-in",
            })
          }
          type="button"
        >
          Continue with ONID
        </Button>
        <Button
          className="mt-3 w-full"
          onClick={() => authClient.signIn.social({ provider: "github" })}
          type="button"
          variant="outline"
        >
          Continue with GitHub
        </Button>
        <p className="mt-6 text-muted-foreground text-sm">
          Already have an account?{" "}
          <Link className="text-brand-dark underline" to="/sign-in">
            Sign in
          </Link>
        </p>
        <p className="mt-2 text-muted-foreground text-sm">
          By creating an account, you agree to the{" "}
          <Link className="text-brand-dark underline" to="/privacy">
            privacy policy
          </Link>
          .
        </p>
      </div>
    </div>
  );
}
