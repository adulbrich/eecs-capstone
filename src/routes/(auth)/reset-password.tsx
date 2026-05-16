import {
  createFileRoute,
  useNavigate,
  useSearch,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { authClient } from "#/lib/auth-client";

const searchSchema = z.object({ token: z.string().min(1) });

export const Route = createFileRoute("/(auth)/reset-password")({
  component: ResetPassword,
  validateSearch: searchSchema,
});

function ResetPassword() {
  const navigate = useNavigate();
  const { token } = useSearch({ from: "/(auth)/reset-password" });
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const { error } = await authClient.resetPassword({
      newPassword: String(form.get("password") ?? ""),
      token,
    });
    if (error) {
      setError(error.message ?? "Reset failed");
      return;
    }
    navigate({ to: "/sign-in" });
  }

  return (
    <div className="mx-auto max-w-sm p-8">
      <h1 className="text-2xl font-semibold">Choose a new password</h1>
      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <input
          name="password"
          type="password"
          placeholder="New password"
          required
          minLength={8}
          className="w-full border p-2"
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="submit" className="w-full bg-black px-4 py-2 text-white">
          Reset password
        </button>
      </form>
    </div>
  );
}
