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

const searchSchema = z.object({ redirect: z.string().optional() });

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
  const { redirect } = useSearch({ from: "/(auth)/sign-in" });
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
          {error && <p className="text-destructive text-sm">{error}</p>}
          <Button className="w-full" disabled={loading} type="submit">
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
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
        <p className="mt-6 text-muted-foreground text-sm">
          <Link className="underline" to="/forgot-password">
            Forgot password?
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
