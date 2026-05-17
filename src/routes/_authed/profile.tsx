import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "#/lib/auth-client";
import { updateProfile } from "#/server/profile";

export const Route = createFileRoute("/_authed/profile")({
  component: Profile,
});

type ProfileUser = {
  id: string;
  email: string;
  name: string | null;
  role: string | null | undefined;
  affiliation?: string | null;
  linkedin?: string | null;
};

function Profile() {
  const router = useRouter();
  const ctx = Route.useRouteContext() as { user: ProfileUser };
  const user = ctx.user;
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const form = new FormData(e.currentTarget);
    try {
      await updateProfile({
        data: {
          name: String(form.get("name") ?? ""),
          affiliation: String(form.get("affiliation") ?? "") || null,
          linkedin: String(form.get("linkedin") ?? "") || null,
        },
      });
      setSaved(true);
      router.invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function onChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = new FormData(e.currentTarget);
    const { error: cpError } = await authClient.changePassword({
      currentPassword: String(form.get("current") ?? ""),
      newPassword: String(form.get("next") ?? ""),
      revokeOtherSessions: true,
    });
    if (cpError) {
      setError(cpError.message ?? "Password change failed");
    } else {
      setSaved(true);
    }
  }

  async function onSignOut() {
    await authClient.signOut();
    window.location.href = "/sign-in";
  }

  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Profile</h1>
      <p className="mt-2 text-sm text-neutral-600">
        {user.email} ({user.role ?? "user"})
      </p>

      <form onSubmit={onSaveProfile} className="mt-6 space-y-3">
        <input
          name="name"
          defaultValue={user.name ?? ""}
          placeholder="Name"
          required
          className="w-full border p-2"
        />
        <input
          name="affiliation"
          defaultValue={user.affiliation ?? ""}
          placeholder="Affiliation"
          className="w-full border p-2"
        />
        <input
          name="linkedin"
          defaultValue={user.linkedin ?? ""}
          placeholder="LinkedIn URL"
          type="url"
          className="w-full border p-2"
        />
        <button type="submit" className="w-full bg-black px-4 py-2 text-white">
          Save
        </button>
      </form>

      <h2 className="mt-8 text-lg font-semibold">Change password</h2>
      <form onSubmit={onChangePassword} className="mt-3 space-y-3">
        <input
          name="current"
          type="password"
          placeholder="Current password"
          required
          className="w-full border p-2"
        />
        <input
          name="next"
          type="password"
          placeholder="New password"
          required
          minLength={8}
          className="w-full border p-2"
        />
        <button type="submit" className="w-full bg-black px-4 py-2 text-white">
          Change password
        </button>
      </form>

      {saved && <p className="mt-4 text-sm text-green-700">Saved.</p>}
      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      <button
        type="button"
        onClick={onSignOut}
        className="mt-8 w-full border px-4 py-2"
      >
        Sign out
      </button>
    </div>
  );
}
