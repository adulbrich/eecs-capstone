import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/(auth)/sign-up")({ component: SignUp });

function SignUp() {
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const { error } = await authClient.signUp.email({
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (error) {
      setError(error.message ?? "Sign-up failed");
      return;
    }
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-sm p-8">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="mt-4 text-sm">
          We sent a verification link to your address. Open it to finish signing
          up. (In dev, check the server console.)
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Create an account</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <input
          name="name"
          placeholder="Name"
          required
          className="w-full border p-2"
        />
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
          minLength={8}
          className="w-full border p-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full bg-brand px-4 py-2 text-white">
          Sign up
        </button>
      </form>
      <button
        type="button"
        onClick={() => authClient.signIn.social({ provider: "github" })}
        className="mt-3 w-full border px-4 py-2"
      >
        Continue with GitHub
      </button>
      <p className="mt-6 text-sm">
        Already have an account?{" "}
        <Link to="/sign-in" className="underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
