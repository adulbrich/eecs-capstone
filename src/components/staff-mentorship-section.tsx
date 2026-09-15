import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import { MENTOR_NEED_LABEL, mentorNeedRefusal } from "#/lib/mentor-need";
import { MENTOR_NEEDS, type MentorNeed } from "#/lib/vocabularies";
import { updateProjectMentorship } from "#/server/projects";
import {
  getProjectMentorship,
  type ProjectMentorship,
} from "#/server/projects-queries";
import { AccountLinkSummary } from "./account-link-summary";
import { PanelSection } from "./panel";
import { ProjectBadges } from "./project-badges";
import { EMAIL_SKIP_HINT } from "./send-email-checkbox";
import { SendEmailDialog } from "./send-email-dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

/**
 * What the public listing will show once this draft is saved, from the draft
 * rather than the saved record, so staff see the effect of a choice before
 * they press Save. The badge rules are the server's (`seekingMentorSql` and
 * `noMentorNeededSql`): seeking AND no address on file, or none needed. The
 * badges themselves are rendered, not described, so the preview cannot
 * drift from the card. The none-plus-address case is named here in the
 * server's own words, from `mentorNeedRefusal` against the saved state, so
 * the line under the draft is the line Save would throw (#373).
 */
function PublicPreview({
  mentorEmail,
  mentorNeed,
  savedMentorNeed,
}: {
  mentorEmail: string;
  mentorNeed: MentorNeed;
  savedMentorNeed: MentorNeed;
}) {
  const hasAddress = mentorEmail.trim() !== "";
  const seeking = mentorNeed === "seeking" && !hasAddress;
  const none = mentorNeed === "none";
  const refusal = mentorNeedRefusal(savedMentorNeed, mentorNeed, hasAddress);
  return (
    <div className="space-y-1 text-muted-foreground text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span>Public listing shows:</span>
        {seeking || none ? (
          <ProjectBadges
            noMentorNeeded={none}
            requiresNdaIp={false}
            seekingMentor={seeking}
            studentProposed={false}
          />
        ) : (
          <span>nothing about mentorship</span>
        )}
      </div>
      {mentorNeed === "seeking" && hasAddress && (
        <p>
          Seeking a mentor is on, but the catalog shows no badge while an
          address is on file. Clear the address or pick another state.
        </p>
      )}
      {refusal && <p>{refusal}</p>}
    </div>
  );
}

/**
 * The staff edit of `mentorNeed` and `mentorEmail`, as a section of the
 * staff panel. Its own component because it owns a load, a draft and a save,
 * and the panel was already at the complexity limit before it arrived.
 *
 * Mentorship only, since #336: who proposed the project is the Proposer
 * section's. The state and the address are independent except that "none"
 * cannot sit beside an address, which the server refuses; the input is
 * always shown, and the preview below it says what the public sees for the
 * draft as typed (#373).
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
  onChanged: () => void;
  projectId: string;
}) {
  const [record, setRecord] = useState<ProjectMentorship | null>(null);
  const [mentorEmail, setMentorEmail] = useState("");
  const [mentorNeed, setMentorNeed] = useState<MentorNeed>("unspecified");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const saved = await getProjectMentorship({ data: { projectId } });
      setRecord(saved);
      setMentorEmail(saved.mentorEmail);
      setMentorNeed(saved.mentorNeed);
    } catch (e) {
      // Reported, not swallowed, and Save stays disabled: see the gate below.
      setError(errorMessage(e, "Could not load the mentor record"));
    }
  }, [projectId]);

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

  async function save(sendEmail: boolean) {
    setBusy(true);
    setError(null);
    try {
      await updateProjectMentorship({
        data: { id: projectId, mentorEmail: trimmed, mentorNeed, sendEmail },
      });
      setConfirmOpen(false);
      await load();
      onChanged();
    } catch (e) {
      setError(errorMessage(e, "Save failed"));
    } finally {
      setBusy(false);
    }
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
            unlinkedHint="Links automatically when they sign up with this address."
          />
        )}
        {/*
          Named by the section title above it, so no legend of its own: two
          "Mentor" headings four lines apart read as a mistake.
        */}
        <RadioGroup
          aria-label="Mentor"
          onValueChange={(value) => setMentorNeed(value as MentorNeed)}
          value={mentorNeed}
        >
          {MENTOR_NEEDS.map((state) => (
            <Label className="font-normal" key={state}>
              <RadioGroupItem value={state} />
              {MENTOR_NEED_LABEL[state]}
            </Label>
          ))}
        </RadioGroup>
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
            Saving a new address emails it.
          </p>
        </div>
        {record && (
          <PublicPreview
            mentorEmail={mentorEmail}
            mentorNeed={mentorNeed}
            savedMentorNeed={record.mentorNeed}
          />
        )}
        {error && !confirmOpen && (
          <p className="text-destructive text-sm">{error}</p>
        )}
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
