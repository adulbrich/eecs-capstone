import {
  createFileRoute,
  Link,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
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

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (error) {
      setError(error.message ?? "Sign-in failed");
      return;
    }
    navigate({ to: redirect ?? "/" });
  }

  return (
    <div className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="w-full border p-2"
        />
        <input
          name="password"
          type="password"
          placeholder="Password"
          required
          className="w-full border p-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full bg-brand px-4 py-2 text-white">
          Sign in
        </button>
      </form>
      <button
        type="button"
        onClick={() =>
          authClient.signIn.social({
            provider: "github",
            callbackURL: redirect ?? "/",
          })
        }
        className="mt-3 w-full border px-4 py-2"
      >
        Continue with GitHub
      </button>
      <p className="mt-6 text-sm">
        <Link to="/forgot-password" className="underline">
          Forgot password?
        </Link>
      </p>
      <p className="mt-2 text-sm">
        No account?{" "}
        <Link to="/sign-up" className="underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
