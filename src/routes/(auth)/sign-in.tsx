import {
  createFileRoute,
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/(auth)/sign-in")({
  component: SignIn,
  validateSearch: searchSchema,
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
        <h1 className="text-2xl font-semibold">Sign in</h1>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="you@example.com"
              required
              autoComplete="email"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </form>
        <Button
          type="button"
          variant="outline"
          className="mt-3 w-full"
          onClick={() =>
            authClient.signIn.social({
              provider: "github",
              callbackURL: redirect ?? "/",
            })
          }
        >
          Continue with GitHub
        </Button>
        <p className="mt-6 text-sm text-muted-foreground">
          <Link to="/forgot-password" className="underline">
            Forgot password?
          </Link>
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          No account?{" "}
          <Link to="/sign-up" className="underline">
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
