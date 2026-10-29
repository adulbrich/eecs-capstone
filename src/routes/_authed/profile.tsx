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
import { FieldError, SavedNote } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Textarea } from "#/components/ui/textarea";
import { pageTitle } from "#/lib/page-title";
import { useSignOut } from "#/lib/sign-out";
import { useAction } from "#/lib/use-action";
import { getAccountDeletionPreview } from "#/server/account";
import { getMyInterests, saveMyInterests } from "#/server/interests";
import { profileSchema, updateProfile } from "#/server/profile";

const LINKEDIN_ERROR_ID = "linkedin-error";

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

function Profile() {
  const router = useRouter();
  const ctx = Route.useRouteContext() as { user: ProfileUser };
  const user = ctx.user;
  // One flight and one result slot per form. These used to be a single shared
  // pair, which is why saving the profile printed "Saved." underneath a form
  // further down the page.
  const profile = useAction({ fallback: "Save failed" });
  const [profileSaved, setProfileSaved] = useState<string | null>(null);
  const [linkedinError, setLinkedinError] = useState<string | null>(null);
  const signingOut = useSignOut();
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
    const data = {
      name: String(form.get("name") ?? ""),
      affiliation: String(form.get("affiliation") ?? "") || null,
      linkedin: String(form.get("linkedin") ?? "") || null,
      wantsToMentor,
      mentorTeamCount,
    };
    // The server parses with the same schema, but a refusal from there
    // arrives as zod's issues JSON, not as the rule's message (#778).
    const parsed = profileSchema.safeParse(data);
    if (!parsed.success) {
      const issues = parsed.error.issues;
      const linkedin = issues.find((issue) => issue.path[0] === "linkedin");
      setLinkedinError(linkedin?.message ?? null);
      const other = issues.find((issue) => issue !== linkedin);
      profile.setError(other?.message ?? null);
      return;
    }
    setLinkedinError(null);
    void profile.run(async () => {
      await updateProfile({ data });
      // Awaited inside the flight: the header reads the name from loader
      // data, and re-enabling Save over the old one shows a stale name with
      // a live button beside it.
      await router.invalidate();
      setProfileSaved("Saved.");
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
      <h1 className="text-2xl font-semibold">Profile</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {user.email} ({user.role ?? "user"})
      </p>

      <div className="mt-6">
        <h2 className="text-sm font-medium">Avatar</h2>
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
          {/* Not `type="url"`: the browser's own refusal would pre-empt the
              rule's messages, and it lets `javascript:` through anyway. */}
          <Input
            aria-describedby={linkedinError ? LINKEDIN_ERROR_ID : undefined}
            aria-invalid={linkedinError ? true : undefined}
            defaultValue={user.linkedin ?? ""}
            id="linkedin"
            inputMode="url"
            name="linkedin"
            onChange={() => setLinkedinError(null)}
            placeholder="https://linkedin.com/in/..."
          />
          <FieldError id={LINKEDIN_ERROR_ID} message={linkedinError} />
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

      <h2 className="border-border mt-8 border-t pt-8 text-lg font-semibold">
        Your interests
      </h2>
      <p className="text-muted-foreground mt-1 text-sm">
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
        <p className="text-muted-foreground mt-1 text-xs" id="interests-count">
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
          <output className="text-muted-foreground mt-2 block text-sm">
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

      <div className="border-border mt-8 border-t pt-8">
        <Button
          className="w-full"
          disabled={signingOut.busy}
          onClick={signingOut.signOut}
          type="button"
          variant="outline"
        >
          {signingOut.busy ? "Signing out..." : "Sign out"}
        </Button>
        <p className="text-muted-foreground mt-3 text-center text-sm">
          <Link className="text-brand-dark underline" to="/privacy">
            Privacy policy
          </Link>
        </p>
      </div>

      <div className="border-destructive/30 mt-8 border-t pt-8">
        <h2 className="text-destructive text-lg font-semibold">Danger zone</h2>
        <p className="text-muted-foreground mt-1 text-sm">
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
