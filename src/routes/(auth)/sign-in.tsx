import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";

const searchSchema = z.object({
  redirect: z.string().optional(),
  // Better Auth redirects a failed OAuth callback to errorCallbackURL with the
  // reason in `error`. Without this the param is not in the route's search
  // schema, so the page renders as if nothing went wrong.
  error: z.string().optional(),
});

/**
 * Copy for the OAuth failures a user can actually do something about.
 *
 * `account_not_linked` is the one that matters. A student who signed up with a
 * password and never clicked the verification link hits it on their first ONID
 * sign-in, because Better Auth will not merge an authenticated identity into an
 * address nobody has proven. That is the correct refusal, but on its own it is
 * a dead end, so the message says which door to go through instead.
 */
const OAUTH_ERRORS: Record<string, string> = {
  account_not_linked:
    "You already have an account with this email address that has not been verified. Sign in with your password and verify your email first, then ONID will link to it.",
  email_is_missing:
    "ONID did not return an email address for your account. Contact the capstone office so we can follow up with UIT.",
  user_info_is_missing:
    "ONID did not return enough information to sign you in. Try again, and contact the capstone office if it keeps happening.",
  signup_disabled: "This account is not permitted to sign up.",
};

function oauthErrorMessage(code: string): string {
  return (
    OAUTH_ERRORS[code] ??
    "Sign-in through ONID failed. Try again, or use your email and password."
  );
}

export const Route = createFileRoute("/(auth)/sign-in")({
  head: () => ({ meta: [{ title: pageTitle("Sign In") }] }),
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
  const navigate = useNavigate();
  const { redirect, error: oauthError } = useSearch({
    from: "/(auth)/sign-in",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const { error: signInError } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    setLoading(false);
    if (signInError) {
      setError(signInError.message ?? "Sign-in failed");
      return;
    }
    navigate({ to: redirect ?? "/" });
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
      <div className="island-shell w-full max-w-sm rounded-xl p-8">
        <h1 className="font-semibold text-2xl">Sign in</h1>
        {oauthError && (
          <p
            className="mt-4 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-destructive text-sm"
            role="alert"
          >
            {oauthErrorMessage(oauthError)}
          </p>
        )}
        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
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
              autoComplete="current-password"
              id="password"
              name="password"
              placeholder="••••••••"
              required
              type="password"
            />
          </div>
          {/* `role="alert"`, like the OAuth error above: a sign-in failure has
              to reach a screen reader, and it is the only announcement this
              form makes. */}
          {error && (
            <p className="text-destructive text-sm" role="alert">
              {error}
            </p>
          )}
          <Button className="w-full" disabled={loading} type="submit">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        <Button
          className="mt-3 w-full"
          onClick={() =>
            authClient.signIn.oauth2({
              providerId: "onid",
              callbackURL: redirect ?? "/",
              errorCallbackURL: "/sign-in",
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
              callbackURL: redirect ?? "/",
            })
          }
          type="button"
          variant="outline"
        >
          Continue with GitHub
        </Button>
        <p className="mt-6 flex flex-wrap gap-x-4 text-muted-foreground text-sm">
          <Link className="underline" to="/forgot-password">
            Forgot password?
          </Link>
          {/* Deliberately not the sign-up sentence: nobody is creating an
              account on this page, so "you agree" would be false here. */}
          <Link className="underline" to="/privacy">
            Privacy policy
          </Link>
        </p>
        <p className="mt-2 text-muted-foreground text-sm">
          No account?{" "}
          <Link className="underline" to="/sign-up">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
