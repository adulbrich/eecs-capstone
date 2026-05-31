import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";
import { pageTitle } from "#/lib/page-title";

export const Route = createFileRoute("/(auth)/forgot-password")({
  head: () => ({ meta: [{ title: pageTitle("Forgot Password") }] }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    await authClient.requestPasswordReset({
      email: String(form.get("email") ?? ""),
      redirectTo: "/reset-password",
    });
    setLoading(false);
    setSubmitted(true);
  }

  if (submitted) {
    return (
      <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
        <div className="island-shell w-full max-w-sm rounded-xl p-8">
          <h1 className="font-semibold text-2xl">Check your email</h1>
          <p className="mt-4 text-muted-foreground text-sm">
            If an account exists for that address, we sent a reset link. (In
            dev, check the server console.)
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-start justify-center px-4 pt-12 pb-20">
      <div className="island-shell w-full max-w-sm rounded-xl p-8">
        <h1 className="font-semibold text-2xl">Forgot password</h1>
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
          <Button className="w-full" disabled={loading} type="submit">
            {loading ? "Sending..." : "Send reset link"}
          </Button>
        </form>
      </div>
    </div>
  );
}
