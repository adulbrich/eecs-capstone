import { useCallback, useEffect, useState } from "react";
import { errorMessage } from "#/lib/error-message";
import {
  clampTeamsSupported,
  TEAMS_SUPPORTED_MAX,
  TEAMS_SUPPORTED_MIN,
} from "#/lib/teams-supported";
import { useAction } from "#/lib/use-action";
import { updateProjectPrograms } from "#/server/projects";
import { getProjectPrograms } from "#/server/projects-queries";
import { PanelSection } from "./panel";
import { ProgramMultiSelect } from "./program-multi-select";
import { Button } from "./ui/button";
import { Checkbox } from "./ui/checkbox";
import { FieldError } from "./ui/field";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type Saved = Awaited<ReturnType<typeof getProjectPrograms>>;

/**
 * The staff edit of a project's programs and of whether its team is full, as
 * a section of the staff panel (#450, #462, #491). Placing a project is staff
 * judgement about how the course runs, so the picker left the proposer's
 * form and this is the only way to set it after create; ADR-0026 records the
 * trade and ADR-0028 records the move from one program to a set. The openings
 * flag followed it for the same reason: staff run bidding and assignment, so
 * staff are the ones who learn a team filled up.
 *
 * It loads its own record on mount, as the Mentor and Categories sections do,
 * rather than seeding from the page's loader (#762). The project page keeps a
 * hover preload for five minutes, and a form seeded from a preload that old
 * could post pre-edit values over a colleague's save; ADR-0062 has the rule.
 * Save is disabled until the load lands, so the blank starting draft can never
 * be posted over a real set.
 *
 * The draft is set from each load and is not resynced otherwise. A set another
 * staff member saved while this panel sat open is not picked up until this
 * section saves or remounts, the same as the single picker before it.
 *
 * One Save for both fields, because three Save buttons in one section would
 * be worse than the navigation #491 removed. The endpoint decides what
 * actually moved and logs each field separately.
 */
export function StaffProgramSection({
  onChanged,
  projectId,
}: {
  onChanged: () => Promise<void>;
  projectId: string;
}) {
  const [saved, setSaved] = useState<Saved | null>(null);
  const [draft, setDraft] = useState<string[]>([]);
  const [teams, setTeams] = useState(1);
  // Held in the glossary's direction rather than the column's. The column is
  // `accepting_applicants` and CONTEXT.md keeps that name on purpose, but the
  // word staff and students both read is "Team is full", so the checkbox says
  // that and the flip happens once, at the save.
  const [full, setFull] = useState(false);
  // `setError` comes back out for the load below, which writes its failure
  // into the same slot, as the Categories section does.
  const { busy, error, run, setError } = useAction({ fallback: "Save failed" });

  const load = useCallback(async () => {
    try {
      const record = await getProjectPrograms({ data: { projectId } });
      setSaved(record);
      setDraft(record.programs.map((p) => p.id));
      setTeams(record.teamsSupported);
      setFull(!record.acceptingApplicants);
    } catch (e) {
      setError(errorMessage(e, "Could not load the programs"));
    }
    // `setError` is the hook's own state setter, so it is stable.
  }, [projectId, setError]);

  useEffect(() => {
    void load();
  }, [load]);

  function save() {
    return run(async () => {
      await updateProjectPrograms({
        data: {
          id: projectId,
          programIds: draft,
          acceptingApplicants: !full,
          teamsSupported: teams,
        },
      });
      await load();
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
        <div className="space-y-1.5">
          <Label htmlFor="staff-teams-supported">Teams supported</Label>
          <Input
            aria-describedby="staff-teams-supported-description"
            className="w-24"
            id="staff-teams-supported"
            max={TEAMS_SUPPORTED_MAX}
            min={TEAMS_SUPPORTED_MIN}
            // The same clamp the proposer's form applies, from the same
            // module, so the two writers cannot disagree about the bounds.
            onBlur={(e) =>
              setTeams(clampTeamsSupported(Number(e.target.value)))
            }
            onChange={(e) => setTeams(Number(e.target.value))}
            type="number"
            value={teams}
          />
          <p
            className="text-muted-foreground text-xs"
            id="staff-teams-supported-description"
          >
            How many separate teams could work on this project at the same time.
            The proposer sets this on their own form and can set it back, so
            raise it here when you place a project in another program rather
            than to overrule them.
          </p>
        </div>
        {saved && (
          <TeamsWarning
            programCount={saved.programs.length}
            teamsSupported={saved.teamsSupported}
          />
        )}
        <FieldError message={error} />
        <Button
          disabled={busy || saved === null}
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
 * Advisory only, and read off the saved values rather than the draft, so it
 * is there on every visit to the panel and not just in the seconds after an
 * edit. The save is never refused: staff may have a reason, and the number is
 * in the same section now, so the warning points at a control the reader is
 * already looking at rather than at somebody to email (#462, #468).
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
      This project supports {teams} but runs in {programCount} programs. Raise
      the number above, or remove a program.
    </p>
  );
}
