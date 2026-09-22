import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { EmailCodeForm } from "#/components/email-code-form";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
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
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [useCode, setUseCode] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const { error: signUpError } = await authClient.signUp.email({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setLoading(false);
    if (signUpError) {
      setError(signUpError.message ?? "Sign-up failed");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
        <div className="island-shell w-full max-w-sm rounded-xl p-8">
          <h1 className="font-semibold text-2xl">Check your email</h1>
          <p className="mt-4 text-muted-foreground text-sm">
            We sent a verification link to your address. Open it to finish
            signing up.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
      <div className="island-shell w-full max-w-sm rounded-xl p-8">
        <h1 className="font-semibold text-2xl">Create an account</h1>
        {/* The same component the sign-in page renders, behaving identically.
            Two pages that answered one address differently would together say
            whether it has an account, which is the enumeration the send
            endpoint is careful not to leak. One at a time, for the reason the
            sign-in page gives. */}
        {useCode && <EmailCodeForm />}
        {!useCode && (
          <form className="mt-6 space-y-4" onSubmit={onSubmit}>
            <div className="space-y-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                autoComplete="name"
                id="name"
                name="name"
                placeholder="Your name"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                autoComplete="email"
                id="email"
                name="email"
                placeholder="you@example.com"
                required
                type="email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                autoComplete="new-password"
                id="password"
                minLength={8}
                name="password"
                placeholder="••••••••"
                required
                type="password"
              />
            </div>
            <FieldError message={error} />
            <Button className="w-full" disabled={loading} type="submit">
              {loading ? "Creating account..." : "Sign up"}
            </Button>
          </form>
        )}
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
        {/* The switch sits with the other secondary choices, the same as on
            the sign-in page and for the same reason. */}
        <p className="mt-6 text-muted-foreground text-sm">
          <Button
            onClick={() => setUseCode((on) => !on)}
            size="bare"
            type="button"
            variant="link"
          >
            {useCode ? "Use a password instead" : "Email me a code instead"}
          </Button>
        </p>
        <p className="mt-2 text-muted-foreground text-sm">
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
