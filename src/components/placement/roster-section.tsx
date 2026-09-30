import { Trash2, UserMinus } from "lucide-react";
import { ConfirmDialog } from "#/components/confirm-dialog";
import { CsvFormatHelp } from "#/components/placement/csv-format";
import { FilePickerButton } from "#/components/placement/file-picker-button";
import { ImportIssues } from "#/components/placement/import-issues";
import { PasteList } from "#/components/placement/paste-list";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { ROSTER_FORMAT } from "#/lib/placement/formats";
import { removeStudents, type Workspace } from "#/lib/placement/workspace";

export const plural = (n: number, one: string, many: string) =>
  `${n} ${n === 1 ? one : many}`;

/** How many emails a warning names before it says how many more. */
const SHOWN = 10;

/**
 * The class roster, on the Roster tab (#665, #717): the whole class, so the
 * students who never answered the survey join the board and the run. It
 * merges with the bids on email and is kept when the bids are removed.
 */
export function RosterSection({
  state,
  workspace,
}: {
  state: PlacementWorkspace;
  workspace: Workspace;
}) {
  const { assignments, bids, roster, update } = state;
  const stored = workspace.roster;
  // Adding a roster leaves the last run on the board, marked stale by the
  // fingerprint. Removing one takes its students out of the run, so the run
  // goes too, as a new bids file's does, along with the pins on students the
  // survey never had: otherwise a placed roster student would silently drop
  // off the results board.
  const setRoster = (next: Workspace["roster"]) =>
    update((w) => ({ ...w, roster: next }));
  const removeRoster = () => {
    const surveyed = new Set(
      (bids?.students ?? []).filter((s) => !s.rosterOnly).map((s) => s.email)
    );
    update((w) => {
      const pins = Object.entries(w.pins ?? {}).filter(([email]) =>
        surveyed.has(email)
      );
      return {
        ...w,
        roster: undefined,
        result: undefined,
        pins: pins.length > 0 ? Object.fromEntries(pins) : undefined,
      };
    });
  };

  if (stored === undefined || roster === null) {
    return (
      <section
        aria-labelledby="placement-roster-heading"
        className="flex flex-col gap-3"
      >
        <div>
          <h2 className="font-medium" id="placement-roster-heading">
            Class roster
          </h2>
          <p className="text-muted-foreground text-sm">
            Every student in the class, so the ones who did not answer the
            survey are placed too. Matched to the bids by email.
          </p>
        </div>
        <div className="flex flex-col items-start gap-2">
          <FilePickerButton
            accept=".csv,text/csv"
            inputLabel="Roster CSV file"
            onText={(text, filename) =>
              setRoster({ source: { kind: "csv", filename }, text })
            }
          >
            Upload roster CSV
          </FilePickerButton>
          <CsvFormatHelp format={ROSTER_FORMAT} label="roster" />
        </div>
        <PasteList
          buttonLabel="Use these emails"
          hint="One per line, or separated by commas, semicolons or spaces. Name <email> works too."
          label="Roster emails"
          onUse={(text) => setRoster({ source: { kind: "pasted" }, text })}
          placeholder={"ada@example.edu\nKim Lee <kim@example.edu>"}
        />
      </section>
    );
  }

  const unit = stored.source.kind === "csv" ? "row" : "line";
  const from =
    stored.source.kind === "csv" ? stored.source.filename : "a pasted list";
  const notInSurvey = bids?.students.filter((s) => s.rosterOnly).length ?? 0;
  const notOnRoster = bids?.notOnRoster ?? [];
  const preApproved = assignments?.pins.size ?? 0;
  const conflicts = bids?.conflicts ?? [];
  const titles = new Map(state.placementProjects.map((p) => [p.key, p.title]));
  const title = (key: string) => titles.get(key) ?? key;
  return (
    <section
      aria-labelledby="placement-roster-heading"
      className="rounded-md border px-3 py-2 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-medium" id="placement-roster-heading">
          Class roster{" "}
          <span className="font-normal text-muted-foreground">
            {plural(roster.entries.length, "student", "students")} from {from}
          </span>
        </h2>
        <ConfirmDialog
          busyLabel="Removing..."
          confirmLabel="Remove"
          description="The students who did not answer the survey leave the board and the run, and so does the last placement. The bids stay."
          onConfirm={removeRoster}
          title="Remove the class roster?"
        >
          <Button size="sm" type="button" variant="ghost">
            <Trash2 aria-hidden="true" />
            Remove roster
          </Button>
        </ConfirmDialog>
      </div>
      {roster.format === "canvas" && (
        <p className="mt-1">
          Read as a Canvas roster and groups export: login_id is the email, and
          each student's group_name is the project they are pre-approved for. A
          group named like a project on the Projects tab joins it; any other
          group becomes a project of its own holding just that group. A student
          in no group is not pre-approved. A student listed twice keeps their
          first group, and the problems list names any other it ignored.
          Canvas's Test Student is left out.
        </p>
      )}
      <p className="mt-1">{rosterSummary(bids === null, notInSurvey)}</p>
      {preApproved > 0 && (
        <p className="mt-1">
          {preApproved === 1
            ? "1 student is pre-approved for a project and placed there on every run."
            : `${preApproved} students are pre-approved for a project and placed there on every run.`}{" "}
          A pre-approval wins over a pin in the bids file. A pin set on the
          Results tab or the Bids tab wins over a pre-approval, and Unpin there
          leaves the student free until the next pin.
        </p>
      )}
      {conflicts.length > 0 && (
        <ul
          aria-label="Pre-approvals over a pin from the bids"
          className="mt-1"
          role="note"
          style={{ color: "var(--status-warning)" }}
        >
          {conflicts.map((c) => (
            <li key={c.email}>
              {c.email} is pre-approved for {title(c.fromRoster)}, over the bids
              file's pin to {title(c.fromBids)}.
            </li>
          ))}
        </ul>
      )}
      {notOnRoster.length > 0 && (
        <p
          className="mt-1"
          role="note"
          style={{ color: "var(--status-warning)" }}
        >
          {notOnRoster.length === 1
            ? "1 student who answered the survey is not on the roster, and stays in the run:"
            : `${notOnRoster.length} students who answered the survey are not on the roster, and stay in the run:`}{" "}
          {notOnRoster.slice(0, SHOWN).join(", ")}
          {notOnRoster.length > SHOWN &&
            `, and ${notOnRoster.length - SHOWN} more`}
          . A student who transferred out of the class is usually one of them.
        </p>
      )}
      {notOnRoster.length > 0 && (
        <div className="mt-1">
          <Button
            onClick={() => update((w) => removeStudents(w, notOnRoster))}
            size="sm"
            type="button"
            variant="outline"
          >
            <UserMinus aria-hidden="true" />
            {notOnRoster.length === 1
              ? "Remove this student"
              : `Remove these ${notOnRoster.length} students`}
          </Button>
        </div>
      )}
      <ImportIssues issues={roster.issues} label="roster" unit={unit} />
    </section>
  );
}

function rosterSummary(noBids: boolean, notInSurvey: number): string {
  if (noBids) {
    return "Upload the bids to match the roster against them.";
  }
  if (notInSurvey === 0) {
    return "Everyone on the roster answered the survey.";
  }
  return `${plural(notInSurvey, "student on the roster did", "students on the roster did")} not answer the survey; they are on the board with no bids. A run places them where a team needs people to reach its minimum, and otherwise on the projects with the fewest bids, never in a seat a bidder would have had. They never make a project form a team on their own under "At least one team per project".`;
}
