import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import type { MentorNeed } from "#/lib/vocabularies";
import { updateProjectMentorship } from "#/server/projects";
import {
  getProjectMentorship,
  type ProjectMentorship,
} from "#/server/projects-queries";
import { AccountLinkSummary } from "./account-link-summary";
import { PanelSection } from "./panel";
import { ProjectBadges } from "./project-badges";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";

/**
 * The three states of the Mentor radio group (#373), in the order they are
 * offered. The values are the enum the column stores; the labels are what
 * staff read.
 */
const MENTOR_NEED_OPTIONS: ReadonlyArray<{ label: string; value: MentorNeed }> =
  [
    { label: "Not decided", value: "unspecified" },
    { label: "Seeking a mentor", value: "seeking" },
    { label: "No mentor needed", value: "none" },
  ];

/**
 * What the public listing will show once this draft is saved, from the draft
 * rather than the saved record, so staff see the effect of a choice before
 * they press Save. The badge rules are the server's (`seekingMentorSql` and
 * `noMentorNeededSql`): seeking AND no address on file, or none needed. The
 * badges themselves are rendered, not described, so the preview cannot
 * drift from the card. The none-plus-address case is named here because the
 * server refuses it (#373).
 */
function PublicPreview({
  mentorEmail,
  mentorNeed,
}: {
  mentorEmail: string;
  mentorNeed: MentorNeed;
}) {
  const hasAddress = mentorEmail.trim() !== "";
  const seeking = mentorNeed === "seeking" && !hasAddress;
  const none = mentorNeed === "none";
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
      {none && hasAddress && (
        <p>Remove the mentor before marking No mentor needed.</p>
      )}
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

  async function save() {
    setBusy(true);
    setError(null);
    try {
      await updateProjectMentorship({
        data: { id: projectId, mentorEmail: mentorEmail.trim(), mentorNeed },
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
        <fieldset className="space-y-1.5">
          <legend className="font-medium text-sm">Mentor</legend>
          <RadioGroup
            aria-label="Mentor"
            className="mt-1.5"
            onValueChange={(value) => setMentorNeed(value as MentorNeed)}
            value={mentorNeed}
          >
            {MENTOR_NEED_OPTIONS.map((option) => (
              <Label className="font-normal" key={option.value}>
                <RadioGroupItem value={option.value} />
                {option.label}
              </Label>
            ))}
          </RadioGroup>
        </fieldset>
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
          <PublicPreview mentorEmail={mentorEmail} mentorNeed={mentorNeed} />
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
