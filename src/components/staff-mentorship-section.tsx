import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import { updateProjectMentorship } from "#/server/projects";
import {
  getProjectMentorship,
  type ProjectMentorship,
} from "#/server/projects-queries";
import { AccountLinkSummary } from "./account-link-summary";
import { MentorshipBadges } from "./mentorship-badges";
import { PanelSection } from "./panel";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * What the public listing will show once this draft is saved, from the draft
 * rather than the saved record, so staff see the effect of a checkbox before
 * they press Save. The badge rule is the server's (`seekingMentorSql`):
 * looking for a mentor AND no address on file. The badge itself is rendered,
 * not described, so the preview cannot drift from the card.
 */
function PublicPreview({
  mentorEmail,
  seekingMentor,
}: {
  mentorEmail: string;
  seekingMentor: boolean;
}) {
  const hasAddress = mentorEmail.trim() !== "";
  const badge = seekingMentor && !hasAddress;
  return (
    <div className="space-y-1 text-muted-foreground text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span>Public listing shows:</span>
        {badge ? (
          <MentorshipBadges seekingMentor studentProposed={false} />
        ) : (
          <span>nothing about mentorship</span>
        )}
      </div>
      {seekingMentor && hasAddress && (
        <p>
          Looking for a mentor is on, but the catalog shows no badge while an
          address is on file. Clear the address or uncheck it.
        </p>
      )}
    </div>
  );
}

/**
 * The staff edit of `seekingMentor` and `mentorEmail`, as a section of the
 * staff panel. Its own component because it owns a load, a draft and a save,
 * and the panel was already at the complexity limit before it arrived.
 *
 * Mentorship only, since #336: who proposed the project is the Proposer
 * section's. The flag and the address stay independent and the input is
 * always shown; the preview below the input says what the public sees for
 * the draft as typed, and the four saved states are the table on #336.
 *
 * The saved record and the draft are held apart: the summary reads the saved
 * one, because whether an address matches an account is only known after the
 * server has seen it. See #75.
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
  const [seekingMentor, setSeekingMentor] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const saved = await getProjectMentorship({ data: { projectId } });
      setRecord(saved);
      setMentorEmail(saved.mentorEmail);
      setSeekingMentor(saved.seekingMentor);
    } catch (e) {
      // Reported, not swallowed, and Save stays disabled: see the gate below.
      setError(errorMessage(e, "Could not load the mentor record"));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateProjectMentorship({
        data: { id: projectId, mentorEmail: mentorEmail.trim(), seekingMentor },
      });
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
        <Label className="font-normal">
          <Checkbox
            checked={seekingMentor}
            onCheckedChange={(checked) => setSeekingMentor(checked === true)}
          />
          Looking for a mentor
        </Label>
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
        </div>
        {record && (
          <PublicPreview
            mentorEmail={mentorEmail}
            seekingMentor={seekingMentor}
          />
        )}
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button
          // Disabled until the saved record has arrived: the drafts start
          // blank, and posting blank drafts over a real record would clear the
          // mentor and log an edit nobody made.
          disabled={busy || record === null}
          onClick={() => void save()}
          size="sm"
          type="button"
        >
          {busy ? "Saving..." : "Save mentor"}
        </Button>
      </div>
    </PanelSection>
  );
}
