import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AvatarUploader } from "#/components/avatar-uploader";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { authClient } from "#/lib/auth-client";
import { pageTitle } from "#/lib/page-title";
import { updateProfile } from "#/server/profile";

export const Route = createFileRoute("/_authed/profile")({
  head: () => ({ meta: [{ title: pageTitle("Profile") }] }),
  component: Profile,
});

interface ProfileUser {
  affiliation?: string | null;
  email: string;
  id: string;
  image?: string | null;
  linkedin?: string | null;
  name: string | null;
  role: string | null | undefined;
}

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
    <div className="mx-auto max-w-md px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">Profile</h1>
      <p className="mt-2 text-muted-foreground text-sm">
        {user.email} ({user.role ?? "user"})
      </p>

      <div className="mt-6">
        <h2 className="font-medium text-sm">Avatar</h2>
        <div className="mt-2">
          <AvatarUploader
            currentKey={(user.image as string | null) ?? null}
            onChanged={() => router.invalidate()}
          />
        </div>
      </div>

      <form className="mt-6 space-y-3" onSubmit={onSaveProfile}>
        <div className="space-y-1.5">
          <Label htmlFor="name">Name</Label>
          <Input
            defaultValue={user.name ?? ""}
            id="name"
            name="name"
            placeholder="Your name"
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="affiliation">Affiliation</Label>
          <Input
            defaultValue={user.affiliation ?? ""}
            id="affiliation"
            name="affiliation"
            placeholder="University, company, ..."
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="linkedin">LinkedIn URL</Label>
          <Input
            defaultValue={user.linkedin ?? ""}
            id="linkedin"
            name="linkedin"
            placeholder="https://linkedin.com/in/..."
            type="url"
          />
        </div>
        <Button className="w-full" type="submit">
          Save profile
        </Button>
      </form>

      <h2 className="mt-8 font-semibold text-lg">Change password</h2>
      <form className="mt-3 space-y-3" onSubmit={onChangePassword}>
        <div className="space-y-1.5">
          <Label htmlFor="current">Current password</Label>
          <Input
            autoComplete="current-password"
            id="current"
            name="current"
            placeholder="••••••••"
            required
            type="password"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="next">New password</Label>
          <Input
            autoComplete="new-password"
            id="next"
            minLength={8}
            name="next"
            placeholder="••••••••"
            required
            type="password"
          />
        </div>
        <Button className="w-full" type="submit">
          Change password
        </Button>
      </form>

      {saved && (
        <p className="mt-4 text-sm" style={{ color: "var(--status-success)" }}>
          Saved.
        </p>
      )}
      {error && <p className="mt-4 text-destructive text-sm">{error}</p>}

      <Button
        className="mt-8 w-full"
        onClick={onSignOut}
        type="button"
        variant="outline"
      >
        Sign out
      </Button>
    </div>
  );
}
