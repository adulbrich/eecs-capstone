import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";

export const Route = createFileRoute("/(auth)/forgot-password")({
  component: ForgotPassword,
});

function ForgotPassword() {
  const [submitted, setSubmitted] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    await authClient.requestPasswordReset({
      email: String(form.get("email") ?? ""),
      redirectTo: "/reset-password",
    });
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="mx-auto max-w-sm p-8">
        <h1 className="text-2xl font-semibold">Check your email</h1>
        <p className="mt-4 text-sm">
          If an account exists for that address, we sent a reset link. (In dev,
          check the server console.)
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Forgot password</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <input
          name="email"
          type="email"
          placeholder="Email"
          required
          className="w-full border p-2"
        />
        <button type="submit" className="w-full bg-brand px-4 py-2 text-white">
          Send reset link
        </button>
      </form>
    </div>
  );
}
