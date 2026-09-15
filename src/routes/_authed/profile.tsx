import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AvatarUploader } from "#/components/avatar-uploader";
import {
  DeleteAccountDialog,
  type DeletionPreview,
} from "#/components/delete-account-dialog";
import { MentorFields } from "#/components/mentor-fields";
import { RecommendedProjectsLink } from "#/components/recommended-projects-link";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { authClient } from "#/lib/auth-client";
import { pageTitle } from "#/lib/page-title";
import { signOut } from "#/lib/sign-out";
import { useAction } from "#/lib/use-action";
import { getAccountDeletionPreview } from "#/server/account";
import { getMyInterests, saveMyInterests } from "#/server/interests";
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
  mentorTeamCount?: number | null;
  name: string | null;
  role: string | null | undefined;
  wantsToMentor?: boolean | null;
}

/**
 * What a form on this page says when it worked, under that form's own submit
 * button. A save that stays on the page confirms inline rather than by toast
 * (UI-CONVENTIONS, "Mutations and feedback").
 *
 * `output` rather than `p` so assistive tech announces it politely when it
 * appears: this is a result the reader asked for, not the interruption
 * `FieldError` is. The two used to be one component switching on a `kind`,
 * which is what put a failure in an element that announces politely and gave
 * this page the only error paragraph in the app not shaped like the others
 * (#411, #410).
 */
function SavedNote({ message }: { message: string | null }) {
  if (!message) {
    return null;
  }
  return (
    <output className="mt-2 block text-sm" style={SAVED_COLOR}>
      {message}
    </output>
  );
}

const SAVED_COLOR = { color: "var(--status-success)" };

function Profile() {
  const router = useRouter();
  const ctx = Route.useRouteContext() as { user: ProfileUser };
  const user = ctx.user;
  // One flight and one result slot per form. These used to be a single shared
  // pair, which is why saving the profile printed "Saved." underneath the
  // change-password form at the very bottom of the page.
  const profile = useAction({ fallback: "Save failed" });
  const [profileSaved, setProfileSaved] = useState<string | null>(null);
  const password = useAction({ fallback: "Password change failed" });
  const [passwordSaved, setPasswordSaved] = useState<string | null>(null);
  const [interests, setInterests] = useState("");
  const savingInterests = useAction({
    fallback: "Could not save your interests. Please try again.",
  });
  // Only what succeeded. The flight and the failure are the hook's, which is
  // what collapsed a five-state machine into one flag beside it.
  const [interestsResult, setInterestsResult] = useState<
    null | "saved" | "degraded"
  >(null);
  const [wantsToMentor, setWantsToMentor] = useState(
    Boolean(user.wantsToMentor)
  );
  const [mentorTeamCount, setMentorTeamCount] = useState(
    user.mentorTeamCount ?? 1
  );

  useEffect(() => {
    void (async () => {
      try {
        const result = await getMyInterests();
        setInterests(result.interestsText);
      } catch {
        // Section stays empty; saving still works.
      }
    })();
  }, []);

  // The delete dialog's contents are this preview, so the trigger stays
  // disabled until it has arrived; a failed load leaves it disabled, which
  // is the safe direction for the most irreversible action on the page.
  const [deletionPreview, setDeletionPreview] =
    useState<DeletionPreview | null>(null);
  useEffect(() => {
    void (async () => {
      try {
        setDeletionPreview(await getAccountDeletionPreview());
      } catch {
        // Trigger stays disabled.
      }
    })();
  }, []);

  function onSaveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setProfileSaved(null);
    const form = new FormData(e.currentTarget);
    void profile.run(async () => {
      await updateProfile({
        data: {
          name: String(form.get("name") ?? ""),
          affiliation: String(form.get("affiliation") ?? "") || null,
          linkedin: String(form.get("linkedin") ?? "") || null,
          wantsToMentor,
          mentorTeamCount,
        },
      });
      // Awaited inside the flight: the header reads the name from loader
      // data, and re-enabling Save over the old one shows a stale name with
      // a live button beside it.
      await router.invalidate();
      setProfileSaved("Saved.");
    });
  }

  function onChangePassword(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setPasswordSaved(null);
    const form = new FormData(e.currentTarget);
    void password.run(async () => {
      // Better Auth returns its failure rather than throwing it, so this is
      // where it becomes a rejection the hook can report.
      const { error: cpError } = await authClient.changePassword({
        currentPassword: String(form.get("current") ?? ""),
        newPassword: String(form.get("next") ?? ""),
        revokeOtherSessions: true,
      });
      if (cpError) {
        throw new Error(cpError.message ?? "Password change failed");
      }
      setPasswordSaved("Password changed.");
    });
  }

  function onSaveInterests(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setInterestsResult(null);
    void savingInterests.run(async () => {
      const result = await saveMyInterests({
        data: { interestsText: interests },
      });
      setInterestsResult(result.embedded ? "saved" : "degraded");
    });
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
        <MentorFields
          count={mentorTeamCount}
          onCountChange={setMentorTeamCount}
          onToggle={setWantsToMentor}
          wants={wantsToMentor}
        />
        <Button className="w-full" disabled={profile.busy} type="submit">
          {profile.busy ? "Saving..." : "Save profile"}
        </Button>
        <FieldError message={profile.error} />
        <SavedNote message={profileSaved} />
      </form>

      <h2 className="mt-8 border-border border-t pt-8 font-semibold text-lg">
        Your interests
      </h2>
      <p className="mt-1 text-muted-foreground text-sm">
        Describe what you would like to work on, in your own words. Only you can
        see this. It is used to sort projects by how well they match you.
      </p>
      <form className="mt-3" onSubmit={onSaveInterests}>
        <Label htmlFor="interests">Interests</Label>
        <Textarea
          aria-describedby="interests-count"
          className="mt-1"
          id="interests"
          maxLength={2000}
          onChange={(e) => {
            setInterests(e.target.value);
            setInterestsResult(null);
            savingInterests.setError(null);
          }}
          placeholder="Robotics, embedded systems, and anything involving sensor data. I have taken CS 344 and I am comfortable with C and Python."
          rows={5}
          value={interests}
        />
        <p className="mt-1 text-muted-foreground text-xs" id="interests-count">
          {interests.length} / 2000
        </p>
        <Button className="mt-2" disabled={savingInterests.busy} type="submit">
          {savingInterests.busy ? "Saving..." : "Save interests"}
        </Button>
        {/*
          The success half keeps its own output and its muted tone: it carries
          a link on the happy path, and "Saved, but" is a caveat rather than a
          failure. The failure half is the same FieldError as every other one
          in the app.
        */}
        {interestsResult && (
          <output className="mt-2 block text-muted-foreground text-sm">
            {interestsResult === "saved" ? (
              <>
                Saved. <RecommendedProjectsLink />
              </>
            ) : (
              "Saved, but we could not prepare your recommendations just now. Save again to retry."
            )}
          </output>
        )}
        <FieldError message={savingInterests.error} />
      </form>

      <h2 className="mt-8 border-border border-t pt-8 font-semibold text-lg">
        Change password
      </h2>
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
        <Button className="w-full" disabled={password.busy} type="submit">
          {password.busy ? "Changing..." : "Change password"}
        </Button>
        <FieldError message={password.error} />
        <SavedNote message={passwordSaved} />
      </form>

      <div className="mt-8 border-border border-t pt-8">
        <Button
          className="w-full"
          onClick={() => void signOut()}
          type="button"
          variant="outline"
        >
          Sign out
        </Button>
        <p className="mt-3 text-center text-muted-foreground text-sm">
          <Link className="text-brand-dark underline" to="/privacy">
            Privacy policy
          </Link>
        </p>
      </div>

      <div className="mt-8 border-destructive/30 border-t pt-8">
        <h2 className="font-semibold text-destructive text-lg">Danger zone</h2>
        <p className="mt-1 text-muted-foreground text-sm">
          Closing your account is immediate and cannot be undone. The{" "}
          <Link className="text-brand-dark underline" to="/privacy">
            privacy policy
          </Link>{" "}
          says what stays.
        </p>
        <div className="mt-3">
          <DeleteAccountDialog
            onDeleted={() => {
              // The sessions are gone server-side, so the cookie is dead; a
              // full load is what makes the header agree.
              window.location.href = "/";
            }}
            preview={deletionPreview}
          />
        </div>
      </div>
    </div>
  );
}
