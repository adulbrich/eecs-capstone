import { useState } from "react";
import type { ProjectProgram } from "#/lib/project-visibility";
import { useAction } from "#/lib/use-action";
import { updateProjectPrograms } from "#/server/projects";
import { PanelSection } from "./panel";
import { ProgramMultiSelect } from "./program-multi-select";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { FieldError } from "./ui/field";
import { Label } from "./ui/label";

/**
 * The staff edit of a project's programs and of whether its team is full, as
 * a section of the staff panel (#450, #462, #491). Placing a project is staff
 * judgement about how the course runs, so the picker left the proposer's
 * form and this is the only way to set it after create; ADR-0026 records the
 * trade and ADR-0028 records the move from one program to a set. The openings
 * flag followed it for the same reason: staff run bidding and assignment, so
 * staff are the ones who learn a team filled up.
 *
 * No load of its own, unlike the Mentor and Categories sections: the
 * programs are already on the detail payload every viewer gets, so the
 * draft starts from the saved set rather than from blank. That also means
 * there is no window where a blank draft could be posted over a real value,
 * which is what those two sections disable Save to avoid.
 *
 * The draft seeds from the saved values once and is never resynced, so the
 * remount is what keeps it honest: the panel is keyed on the project
 * (`<StaffProjectPanel key={project.id}>`), so a navigation between two
 * projects cannot leave A's programs in B's picker. A set another staff
 * member saved while this panel sat open is not picked up, the same as the
 * single picker before it.
 *
 * One Save for both fields, because three Save buttons in one section would
 * be worse than the navigation #491 removed. The endpoint decides what
 * actually moved and logs each field separately.
 */
export function StaffProgramSection({
  acceptingApplicants,
  onChanged,
  programs,
  projectId,
  teamsSupported,
}: {
  acceptingApplicants: boolean;
  onChanged: () => Promise<void>;
  programs: ProjectProgram[];
  projectId: string;
  teamsSupported: number;
}) {
  const [draft, setDraft] = useState(() => programs.map((p) => p.id));
  // Held in the glossary's direction rather than the column's. The column is
  // `accepting_applicants` and CONTEXT.md keeps that name on purpose, but the
  // word staff and students both read is "Team is full", so the checkbox says
  // that and the flip happens once, at the save.
  const [full, setFull] = useState(() => !acceptingApplicants);
  const { busy, error, run } = useAction({ fallback: "Save failed" });

  function save() {
    return run(async () => {
      await updateProjectPrograms({
        data: {
          id: projectId,
          programIds: draft,
          acceptingApplicants: !full,
        },
      });
      await onChanged();
    });
  }

  return (
    <PanelSection title="Programs and teams">
      <div className="space-y-3">
        <div className="space-y-1.5">
          <ProgramMultiSelect
            describedBy="staff-programs-description"
            onChange={setDraft}
            value={draft}
          />
          <p
            className="text-muted-foreground text-xs"
            id="staff-programs-description"
          >
            The programs this project runs in. Staff set them; the proposer
            cannot. Leave them all unchecked for a project not yet placed.
          </p>
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Checkbox
              aria-describedby="staff-team-full-description"
              checked={full}
              id="staff-team-full"
              onCheckedChange={(next) => setFull(next === true)}
            />
            <Label className="font-normal" htmlFor="staff-team-full">
              Team is full
            </Label>
          </div>
          <p
            className="text-muted-foreground text-xs"
            id="staff-team-full-description"
          >
            Staff set this; the proposer cannot. The project stays in the
            catalog and its page says the team is full, and the listing hides it
            unless a student asks for full teams too.
          </p>
        </div>
        <TeamsWarning
          programCount={programs.length}
          teamsSupported={teamsSupported}
        />
        <FieldError message={error} />
        <Button
          disabled={busy}
          onClick={() => void save()}
          size="sm"
          type="button"
        >
          {busy ? "Saving..." : "Save programs and teams"}
        </Button>
      </div>
    </PanelSection>
  );
}

/**
 * Advisory only, and read off the saved set rather than the draft, so it is
 * there on every visit to the panel and not just in the seconds after an
 * edit. The save is never refused: `teams_supported` is a proposer field and
 * staff cannot edit it from here, so refusing would leave them with no way
 * forward (#462, #468 is the follow-up if that proves annoying).
 *
 * The predicate is general rather than "two programs, one team": three
 * programs against two teams is the same problem and reads the same way.
 */
function TeamsWarning({
  programCount,
  teamsSupported,
}: {
  programCount: number;
  teamsSupported: number;
}) {
  if (programCount <= teamsSupported) {
    return null;
  }
  const teams = teamsSupported === 1 ? "1 team" : `${teamsSupported} teams`;
  return (
    // `warning`, not `destructive`: UI-CONVENTIONS reserves the destructive
    // palette for a hard stop, and this is something staff may still act on.
    <p className="text-xs" style={{ color: "var(--status-warning)" }}>
      This project supports {teams} but runs in {programCount} programs. Ask the
      proposer to raise it, or remove a program.
    </p>
  );
}
