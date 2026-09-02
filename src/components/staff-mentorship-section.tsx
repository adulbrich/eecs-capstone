import { useCallback, useEffect, useState } from "react";
import { updateProjectMentorship } from "#/server/projects";
import {
  getProjectMentorship,
  type ProjectMentorship,
} from "#/server/projects-queries";
import { PanelSection } from "./panel";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/**
 * Whether the saved address has an account, stated from the saved record
 * rather than the draft: the match is resolved server-side and is only known
 * after a save. A student-proposed project with no address is what the public
 * sees as "Seeking mentor", so that is said here too.
 */
function MentorshipHint({ record }: { record: ProjectMentorship | null }) {
  if (!record) {
    return null;
  }
  if (!record.mentorEmail) {
    return (
      <p className="text-muted-foreground text-xs">
        {record.studentProposed
          ? "No mentor on file. The catalog shows this project as seeking a mentor."
          : "No mentor on file."}
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-xs">
      {record.mentorName
        ? `Account: ${record.mentorName}`
        : "No account with this address yet. The catalog shows no mentor until they sign up."}
    </p>
  );
}

/**
 * The staff edit of `studentProposed` and `mentorEmail`, as a section of the
 * staff panel. Its own component because it owns a load, a draft and a save,
 * and the panel was already at the complexity limit before it arrived.
 *
 * The saved record and the draft are held apart: the hint reads the saved
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
  const [studentProposed, setStudentProposed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const saved = await getProjectMentorship({ data: { projectId } });
      setRecord(saved);
      setMentorEmail(saved.mentorEmail);
      setStudentProposed(saved.studentProposed);
    } catch {
      // Staff-only endpoint; on failure the section stays at its defaults and
      // a save still round-trips through the server's own gate.
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
          studentProposed,
        },
      });
      await load();
      onChanged();
    } catch (e) {
      setError((e as Error)?.message || "Save failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <PanelSection title="Mentorship">
      <div className="space-y-3">
        <Label className="font-normal">
          <Checkbox
            checked={studentProposed}
            onCheckedChange={(checked) => setStudentProposed(checked === true)}
          />
          Student proposed
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
          <MentorshipHint record={record} />
        </div>
        {error && <p className="text-destructive text-sm">{error}</p>}
        <Button
          disabled={busy}
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
