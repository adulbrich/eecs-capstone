import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { EmailCodeForm } from "#/components/email-code-form";
import { OAuthErrorBanner } from "#/components/oauth-error-banner";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { NOINDEX } from "#/lib/social-meta";

const searchSchema = z.object({
  redirect: z.string().optional(),
  // Better Auth redirects a failed OAuth callback to errorCallbackURL with the
  // reason in `error`. Without this the param is not in the route's search
  // schema, so the page renders as if nothing went wrong.
  error: z.string().optional(),
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
  const navigate = useNavigate();
  const { redirect: redirectTo, error: oauthError } = useSearch({
    from: "/(auth)/sign-in",
  });
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    // No callbackURL here. Better Auth would echo it back as a redirect on a
    // successful sign-in too, and the client would follow it instead of the
    // navigate below (#254). The link a refused sign-in mails still lands on
    // /verify-email: `sendVerificationEmail` in auth.ts sets that.
    const { error: signInError } = await authClient.signIn.email({
      email,
      password: String(form.get("password") ?? ""),
    });
    setLoading(false);
    if (signInError) {
      // Better Auth's own message says only that the address is unverified.
      // The refusal is also what mailed the new link, so say so, or the
      // person has no reason to look in their inbox.
      setError(
        signInError.code === "EMAIL_NOT_VERIFIED"
          ? `This account has not verified its email yet. A new verification link was just sent to ${email}; it expires in an hour.`
          : (signInError.message ?? "Sign-in failed")
      );
      return;
    }
    navigate({ to: redirectTo ?? "/" });
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
      <div className="island-shell w-full max-w-sm rounded-xl p-8">
        <h1 className="font-semibold text-2xl">Sign in</h1>
        {oauthError && <OAuthErrorBanner code={oauthError} />}
        {/* The emailed code comes first because it is what this page will be
            once #576 removes the password. Both are live for one release so
            people meet the new door before the old one closes. */}
        <EmailCodeForm redirectTo={redirectTo} />
        <div className="mt-8 border-border border-t pt-6">
          <h2 className="font-medium text-muted-foreground text-sm">
            Or sign in with a password
          </h2>
        </div>
        <form className="mt-4 space-y-4" onSubmit={onSubmit}>
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
          {/* FieldError announces, which matters most here: a sign-in
              failure is the only announcement this form makes. */}
          <FieldError message={error} />
          <Button className="w-full" disabled={loading} type="submit">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        <Button
          className="mt-3 w-full"
          onClick={() =>
            authClient.signIn.oauth2({
              providerId: "onid",
              callbackURL: redirectTo ?? "/",
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
              callbackURL: redirectTo ?? "/",
            })
          }
          type="button"
          variant="outline"
        >
          Continue with GitHub
        </Button>
        <p className="mt-6 flex flex-wrap gap-x-4 text-muted-foreground text-sm">
          <Link className="text-brand-dark underline" to="/forgot-password">
            Forgot password?
          </Link>
          {/* Deliberately not the sign-up sentence: nobody is creating an
              account on this page, so "you agree" would be false here. */}
          <Link className="text-brand-dark underline" to="/privacy">
            Privacy policy
          </Link>
        </p>
        <p className="mt-2 text-muted-foreground text-sm">
          No account?{" "}
          <Link className="text-brand-dark underline" to="/sign-up">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
