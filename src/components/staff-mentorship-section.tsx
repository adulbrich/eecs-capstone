import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import { updateProjectMentorship } from "#/server/projects";
import {
  getProjectMentorship,
  type ProjectMentorship,
} from "#/server/projects-queries";
import { AccountLinkSummary } from "./account-link-summary";
import { PanelSection } from "./panel";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * What the catalog shows for the saved record, stated from the saved record
 * rather than the draft: whether an address matches an account is resolved
 * server-side and only known after a save. The badge rule is the server's
 * (`seekingMentorSql`): looking for a mentor AND no address on file.
 */
function MentorshipHint({ record }: { record: ProjectMentorship }) {
  if (record.mentorEmail) {
    return record.seekingMentor ? (
      <p className="text-muted-foreground text-xs">
        Looking for a mentor is on, but the catalog shows no badge while an
        address is on file. Clear the address or uncheck it.
      </p>
    ) : null;
  }
  return (
    <p className="text-muted-foreground text-xs">
      {record.seekingMentor
        ? "The catalog shows this project as seeking a mentor."
        : "No mentor on file, and the catalog says nothing about mentorship."}
    </p>
  );
}

/**
 * The staff edit of `studentProposed`, `seekingMentor` and `mentorEmail`, as
 * a section of the staff panel. Its own component because it owns a load, a
 * draft and a save, and the panel was already at the complexity limit before
 * it arrived.
 *
 * Two visually separate rows because they are two facts (#304): who proposed
 * the project, and whether it wants a mentor. A student project may have a
 * mentor, want one, or need none; a partner project may want one too. One
 * save still writes all three fields.
 *
 * The saved record and the draft are held apart: the summary and hint read the
 * saved one, because whether an address matches an account is only known
 * after the server has seen it. See #75.
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
  const [studentProposed, setStudentProposed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const saved = await getProjectMentorship({ data: { projectId } });
      setRecord(saved);
      setMentorEmail(saved.mentorEmail);
      setSeekingMentor(saved.seekingMentor);
      setStudentProposed(saved.studentProposed);
    } catch (e) {
      // Reported, not swallowed, and Save stays disabled: see the gate below.
      setError(errorMessage(e, "Could not load the mentorship record"));
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
        data: {
          id: projectId,
          mentorEmail: mentorEmail.trim(),
          seekingMentor,
          studentProposed,
        },
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
    <PanelSection title="Mentorship">
      <div className="space-y-4">
        <div className="space-y-1">
          <Label className="font-normal">
            <Checkbox
              checked={studentProposed}
              onCheckedChange={(checked) =>
                setStudentProposed(checked === true)
              }
            />
            Student proposed
          </Label>
          <p className="text-muted-foreground text-xs">
            Shown as a badge. Says who proposed the project, not whether it has
            a mentor.
          </p>
        </div>
        <div className="space-y-3 border-border border-t pt-3">
          {record && (
            <AccountLinkSummary
              accountLinked={record.mentorName !== null}
              accountName={record.mentorName}
              email={record.mentorEmail || null}
              label="Mentor"
              unlinkedHint="The catalog shows no mentor until they sign up with this address."
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
            {record && <MentorshipHint record={record} />}
          </div>
        </div>
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
          {busy ? "Saving..." : "Save mentorship"}
        </Button>
      </div>
    </PanelSection>
  );
}
