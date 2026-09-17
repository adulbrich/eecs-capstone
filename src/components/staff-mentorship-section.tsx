import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import { useAction } from "#/lib/use-action";
import { updateProjectMentorship } from "#/server/projects";
import {
  getProjectMentorship,
  type ProjectMentorship,
} from "#/server/projects-queries";
import { AccountLinkSummary } from "./account-link-summary";
import { PanelSection } from "./panel";
import { EMAIL_SKIP_HINT } from "./send-email-checkbox";
import { SendEmailDialog } from "./send-email-dialog";
import { Button } from "./ui/button";
import { FieldError } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * The staff edit of `mentorEmail`, as a section of the staff panel. Its own
 * component because it owns a load, a draft and a save, and the panel was
 * already at the complexity limit before it arrived.
 *
 * Mentorship only, since #336: who proposed the project is the Proposer
 * section's. The address is the whole record since #402: no state beside
 * it, nothing the public sees, so no preview under the draft.
 *
 * The saved record and the draft are held apart: the summary reads the saved
 * one, because whether an address matches an account is only known after the
 * server has seen it. See #75.
 *
 * A save that names a new address emails it, so that save goes through a
 * confirm carrying the skip (#379); the state alone, or the same address,
 * saves without one. The mentor has no account to write a bell row for, so
 * the skip is the whole notice.
 */
export function StaffMentorshipSection({
  onChanged,
  projectId,
}: {
  onChanged: () => Promise<void>;
  projectId: string;
}) {
  const [record, setRecord] = useState<ProjectMentorship | null>(null);
  const [mentorEmail, setMentorEmail] = useState("");
  // A second activation in the same tick would mail the mentor twice;
  // `use-action.ts` says why the hook's ref is what stops it (#443).
  // `setError` comes back out for the load below, which shares the slot.
  const { busy, error, run, setError } = useAction({ fallback: "Save failed" });
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const saved = await getProjectMentorship({ data: { projectId } });
      setRecord(saved);
      setMentorEmail(saved.mentorEmail);
    } catch (e) {
      // Reported, not swallowed, and Save stays disabled: see the gate below.
      setError(errorMessage(e, "Could not load the mentor record"));
    }
    // `setError` is the hook's own state setter, so it is stable and the
    // dependency costs nothing; Biome cannot see that from here.
  }, [projectId, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  const trimmed = mentorEmail.trim();
  // The server mails only when the address changes to a non-empty value,
  // compared after normalizing; the dialog opens on exactly that, or it
  // would announce an email that never goes out.
  const announces =
    record !== null &&
    trimmed !== "" &&
    trimmed.toLowerCase() !== record.mentorEmail;

  function save(sendEmail: boolean) {
    return run(async () => {
      await updateProjectMentorship({
        data: { id: projectId, mentorEmail: trimmed, sendEmail },
      });
      setConfirmOpen(false);
      await load();
      await onChanged();
    });
  }

  return (
    <PanelSection title="Mentor">
      <div className="space-y-3">
        {record && (
          <AccountLinkSummary
            accountLinked={record.mentorName !== null}
            accountName={record.mentorName}
            email={record.mentorEmail || null}
            label="Mentor"
            // Sign-up, not the proposer's verify: mentorship has no
            // `mentor_id` and no claim, so registering is the moment a mentor
            // links. See "Mentorship is one nullable address" in
            // docs/QUIRKS.md, and #466.
            unlinkedHint="Links automatically when they sign up with this address."
          />
        )}
        <div className="space-y-1.5">
          <Label htmlFor="mentor-email">Mentor email</Label>
          <Input
            autoComplete="off"
            id="mentor-email"
            onChange={(e) => setMentorEmail(e.target.value)}
            placeholder="mentor@example.com"
            type="email"
            value={mentorEmail}
          />
          <p className="text-muted-foreground text-xs">
            Saving a new address emails it; the confirm that opens lets you skip
            the email. Leave it empty for a project with no mentor; an
            instructor who runs the team records their own.
          </p>
        </div>
        {!confirmOpen && <FieldError message={error} />}
        <Button
          // Disabled until the saved record has arrived: the drafts start
          // blank, and posting blank drafts over a real record would clear the
          // mentor and log an edit nobody made.
          disabled={busy || record === null}
          onClick={() => (announces ? setConfirmOpen(true) : void save(true))}
          size="sm"
          type="button"
        >
          {busy ? "Saving..." : "Save mentor"}
        </Button>
      </div>
      <SendEmailDialog
        address={trimmed}
        busy={busy}
        confirmLabel="Save mentor"
        description={`This names ${trimmed} as the mentor.`}
        error={error}
        hint={EMAIL_SKIP_HINT.emailOnly}
        onConfirm={(sendEmail) => void save(sendEmail)}
        onOpenChange={setConfirmOpen}
        open={confirmOpen}
        title="Save the mentor?"
      />
    </PanelSection>
  );
}
