import {
  ChevronsUpDown,
  Download,
  Pin,
  PinOff,
  Play,
  Square,
  TriangleAlert,
} from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { ErrorBanner } from "#/components/error-banner";
import { RemoveStudentButton } from "#/components/placement/removed-students";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "#/components/ui/command";
import { FieldError } from "#/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "#/components/ui/popover";
import { ordinal } from "#/lib/placement/analytics";
import {
  applyPins,
  type BoardRow,
  bidsWithPinsCsv,
  boardRows,
  describeRun,
  moveStudent,
  moveTargets,
  placementCsv,
  projectsWithoutTeam,
  removeFromResult,
  unplacedReason,
} from "#/lib/placement/board";
import { downloadText } from "#/lib/placement/download";
import { runPlacement } from "#/lib/placement/run-placement";
import type {
  PlacementResult,
  PlacementStudent,
  WorkspaceProject,
} from "#/lib/placement/types";
import {
  inputFingerprint,
  toPlacementInput,
  type Workspace,
} from "#/lib/placement/workspace";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useLocalTableSearch } from "#/lib/use-local-table-search";

const DEFAULT_SORT: SortState = { desc: false, id: "student" };

const WARNING_STYLE = { color: "var(--status-warning)" };

export function ResultsTab({
  state,
  workspace,
}: {
  state: PlacementWorkspace;
  workspace: Workspace;
}) {
  const { bids, update } = state;
  // Listed projects plus any the roster adds (#670).
  const allProjects = state.placementProjects;
  const students = useMemo(
    () => applyPins(bids?.students ?? [], workspace.pins),
    [bids, workspace.pins]
  );
  const titles = useMemo(
    () => new Map(allProjects.map((p) => [p.key, p.title])),
    [allProjects]
  );
  // Hashes the whole bids text, and this panel stays mounted while other
  // tabs are edited, so it is worked out once per change to its inputs.
  const {
    projects,
    parameters,
    bids: stored,
    titleMatches,
    roster,
  } = workspace;
  const fingerprint = useMemo(
    () =>
      inputFingerprint({
        projects,
        parameters,
        bids: stored,
        titleMatches,
        roster,
      }),
    [projects, parameters, stored, titleMatches, roster]
  );
  const [running, setRunning] = useState(false);
  // A failed run, and the inputs it read: it stops being shown once they
  // change, since its diagnostics may no longer hold.
  const [failed, setFailed] = useState<{
    fingerprint: string;
    result: PlacementResult;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  let missing: string | null = null;
  if (workspace.projects.length === 0) {
    missing = "Load the projects first, on the Projects tab.";
  } else if (students.length === 0) {
    missing = "Upload the bids first, on the Bids tab.";
  }

  async function run() {
    // Taken before the await: an edit made while the solver runs must leave
    // the result marked stale, not stamped with inputs it never read.
    const read = fingerprint;
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setError(null);
    try {
      const result = await runPlacement(
        toPlacementInput(workspace, students, allProjects),
        controller.signal
      );
      const usable =
        (result.status === "optimal" || result.status === "time_limit") &&
        result.placements.length > 0;
      if (usable) {
        setFailed(null);
        // A student removed while the solver ran was in its input; the
        // result drops them as a removal before the run would have (#679).
        update((w) => ({
          ...w,
          result: removeFromResult(
            { ...result, at: new Date().toISOString(), fingerprint: read },
            w.removed ?? []
          ),
        }));
      } else {
        // The previous placement stays on screen; this run explains itself.
        setFailed({ fingerprint: read, result });
      }
    } catch (e) {
      if (!controller.signal.aborted) {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      abort.current = null;
      setRunning(false);
    }
  }

  const result = workspace.result;
  // A failed run is shown only while the inputs it read are unchanged.
  const failure = failed?.fingerprint === fingerprint ? failed.result : null;
  const rows = useMemo(
    () => (result ? boardRows(result, students, allProjects) : []),
    [result, students, allProjects]
  );

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {running ? (
          <Button
            onClick={() => abort.current?.abort()}
            size="sm"
            type="button"
            variant="outline"
          >
            <Square aria-hidden="true" />
            Cancel
          </Button>
        ) : (
          <Button
            disabled={missing !== null}
            onClick={() => void run()}
            size="sm"
            type="button"
          >
            <Play aria-hidden="true" />
            {result ? "Run placement again" : "Run placement"}
          </Button>
        )}
        {running && (
          <span aria-live="polite" className="text-muted-foreground text-sm">
            Placing {students.length} students...
          </span>
        )}
        {result && (
          <div className="ml-auto flex flex-wrap gap-2">
            <Button
              onClick={() =>
                downloadText(
                  `placement-${today()}.csv`,
                  placementCsv(rows, titles),
                  "text/csv"
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Download aria-hidden="true" />
              Download placement
            </Button>
            <Button
              onClick={() =>
                downloadText(
                  `bids-with-pins-${today()}.csv`,
                  bidsWithPinsCsv(students, titles),
                  "text/csv"
                )
              }
              size="sm"
              type="button"
              variant="outline"
            >
              <Download aria-hidden="true" />
              Download bids with pins
            </Button>
          </div>
        )}
      </div>
      {missing && <p className="mt-2 text-sm">{missing}</p>}
      <FieldError message={error} />
      {failed &&
        failure === null &&
        result === undefined &&
        missing === null && (
          // A run that failed after its inputs changed under it: its reasons
          // may no longer hold, but the reader still learns it failed.
          <p className="mt-2 text-sm">
            The last run failed, and the projects, parameters or bids changed
            while it ran. Run placement again.
          </p>
        )}
      {failure && (
        <ErrorBanner className="mt-4">
          <ul className="space-y-0.5">
            {[
              ...describeRun(failure, titles),
              ...(result
                ? [
                    "The board below still shows the last run that worked, not this one.",
                  ]
                : []),
            ].map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </ErrorBanner>
      )}
      {result && (
        <Board
          failed={failure !== null}
          projects={allProjects}
          result={result}
          rows={rows}
          // After a failed run the alert above says what to do; "run again"
          // would tell the reader to repeat what just failed (#680).
          stale={failure === null && result.fingerprint !== fingerprint}
          students={students}
          titles={titles}
          update={update}
          workspace={workspace}
        />
      )}
    </div>
  );
}

function RunReport({ lines }: { lines: string[] }) {
  return (
    <section
      aria-label="How the run went"
      className="mt-4 rounded-md border px-3 py-2 text-sm"
    >
      <ul className="space-y-0.5">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </section>
  );
}

function Board({
  failed,
  projects,
  result,
  rows,
  stale,
  students,
  titles,
  update,
  workspace,
}: {
  /** The latest run failed, so this board is from an earlier one. */
  failed: boolean;
  projects: WorkspaceProject[];
  result: NonNullable<Workspace["result"]>;
  rows: BoardRow[];
  stale: boolean;
  students: PlacementStudent[];
  titles: Map<string, string>;
  update: PlacementWorkspace["update"];
  workspace: Workspace;
}) {
  const { navigate, search } = useLocalTableSearch();
  const placed = rows.filter((r) => r.projectKey !== null);
  const first = placed.filter((r) => r.priority === 1).length;
  const empty = projectsWithoutTeam(
    result,
    projects,
    workspace.parameters.maxTeams
  );
  const notes = [
    `${placed.length} of ${rows.length} students placed, ${first} on their first choice, at ${new Date(result.at).toLocaleString()}.`,
    ...(stale
      ? [
          "The projects, parameters or bids changed since this run. Run placement again to use them.",
        ]
      : []),
    ...(result.edited
      ? [
          "Students were moved or removed by hand since this run; run again to balance the teams.",
        ]
      : []),
    ...describeRun(result, titles).slice(1),
  ];

  const columns = useMemo(() => {
    const pin = (email: string, projectKey: string | null) =>
      update((w) => ({ ...w, pins: { ...w.pins, [email]: projectKey } }));
    const move = (row: BoardRow, projectKey: string) => {
      // The bid's priority travels with the move, so the file and the row
      // both say which choice the new project was.
      const priority =
        students
          .find((s) => s.email === row.email)
          ?.bids.find((b) => b.projectKey === projectKey)?.priority ?? null;
      update((w) => ({
        ...w,
        pins: { ...w.pins, [row.email]: projectKey },
        result:
          w.result && moveStudent(w.result, row.email, projectKey, priority),
      }));
    };
    return defineAdminColumns<BoardRow>()([
      {
        accessorFn: (row) => row.name || row.email,
        cardHeader: true,
        cell: ({ row }) => (
          <div>
            <div>{row.original.name || row.original.email}</div>
            {row.original.name && (
              <div className="text-muted-foreground text-xs">
                {row.original.email}
              </div>
            )}
            {row.original.avoid && (
              <p
                className="mt-1 flex items-start gap-1 text-xs"
                role="note"
                style={WARNING_STYLE}
              >
                <TriangleAlert
                  aria-hidden="true"
                  className="mt-px size-3 shrink-0"
                />
                <span>
                  <span className="font-medium">Prefers not to work with:</span>{" "}
                  {row.original.avoid}
                </span>
              </p>
            )}
          </div>
        ),
        enableHiding: false,
        enableSorting: false,
        header: "Student",
        id: "student",
      },
      {
        accessorFn: (row) => priorityLabel(row),
        cell: ({ row }) => priorityLabel(row.original),
        enableSorting: false,
        header: "Priority",
        id: "priority",
      },
      {
        accessorFn: (row) => row.comment || undefined,
        cell: ({ row }) => (
          <div className="whitespace-pre-line md:min-w-xs md:max-w-md">
            {row.original.projectKey === null
              ? unplacedReason(row.original.unplacedReason)
              : row.original.comment || "-"}
          </div>
        ),
        enableSorting: false,
        header: "Comment",
        id: "comment",
      },
      {
        cell: ({ row }) => (
          <RowActions
            defaultMaxTeams={workspace.parameters.maxTeams}
            onMove={(key) => move(row.original, key)}
            onPin={(key) => pin(row.original.email, key)}
            projects={projects}
            row={row.original}
            update={update}
          />
        ),
        enableHiding: false,
        enableSorting: false,
        header: "Actions",
        id: "actions",
      },
    ]);
  }, [students, update, projects, workspace.parameters.maxTeams]);

  const { tableProps } = useAdminTable({
    columns,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "placement-results",
  });

  return (
    <div className="mt-4">
      {failed && (
        <h2 className="font-medium">
          Last run that worked, {new Date(result.at).toLocaleString()}
        </h2>
      )}
      <RunReport lines={notes} />
      <p className="mt-2 text-muted-foreground text-sm">
        Approve pins a student to the project they are on for every later run,
        over any pin from the bids file or the roster; Pin here on the Bids tab
        does the same. Move puts the student on another project now and pins
        them there, so later runs keep them there. Unpin frees the student from
        every pin, and the next run places them by their bids. A pin changes the
        next run, not the placement shown here. Remove takes the student off
        this board and out of every run until you restore them on the Bids tab.
      </p>
      {empty.length > 0 && (
        <p className="mt-2 text-sm">
          No team formed: {empty.map((p) => p.title).join(", ")}.
        </p>
      )}
      <div className="mt-4">
        <AdminDataTable
          caption="Placement by team, unplaced students first"
          data={rows}
          emptyMessage="Nobody to place."
          getRowId={(row) => row.email}
          group={{
            header: (groupRows) => (
              <span>
                {groupRows[0].groupLabel}
                <span className="ml-2 font-normal text-muted-foreground text-xs">
                  {groupRows.length}{" "}
                  {groupRows.length === 1 ? "student" : "students"}
                </span>
              </span>
            ),
            key: (row) => row.groupKey,
          }}
          {...tableProps}
        />
      </div>
    </div>
  );
}

function priorityLabel(row: BoardRow): string {
  if (row.projectKey === null) {
    return "-";
  }
  if (row.preApproved) {
    return "Pre-approved";
  }
  if (row.priority !== null) {
    return row.pinned
      ? `${ordinal(row.priority)}, pinned`
      : ordinal(row.priority);
  }
  if (row.rosterOnly) {
    return row.pinned ? "Pinned, not in the survey" : "Not in the survey";
  }
  return row.pinned ? "Pinned, not in their bids" : "Not in their bids";
}

function RowActions({
  defaultMaxTeams,
  onMove,
  onPin,
  projects,
  row,
  update,
}: {
  defaultMaxTeams: number;
  onMove: (projectKey: string) => void;
  onPin: (projectKey: string | null) => void;
  projects: Workspace["projects"];
  row: BoardRow;
  update: PlacementWorkspace["update"];
}) {
  const who = row.name || row.email;
  return (
    <div className="flex flex-wrap items-center gap-1">
      {row.projectKey !== null &&
        (row.pinned ? (
          <Button
            aria-label={`Unpin ${who}`}
            onClick={() => onPin(null)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <PinOff aria-hidden="true" />
            Unpin
          </Button>
        ) : (
          <Button
            aria-label={`Approve ${who} here`}
            onClick={() => onPin(row.projectKey)}
            size="sm"
            type="button"
            variant="ghost"
          >
            <Pin aria-hidden="true" />
            Approve
          </Button>
        ))}
      <MoveTo
        current={row.projectKey}
        defaultMaxTeams={defaultMaxTeams}
        label={`Move ${who}`}
        onMove={onMove}
        projects={projects}
      />
      <RemoveStudentButton email={row.email} name={row.name} update={update} />
    </div>
  );
}

/**
 * The Move to... picker (#678): the projects by title, narrowed by any word
 * typed, since a term's list runs to dozens of projects.
 */
function MoveTo({
  current,
  defaultMaxTeams,
  label,
  onMove,
  projects,
}: {
  current: string | null;
  defaultMaxTeams: number;
  label: string;
  onMove: (projectKey: string) => void;
  projects: Workspace["projects"];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const targets = moveTargets(projects, current, defaultMaxTeams, query);
  const choose = (projectKey: string) => {
    setOpen(false);
    setQuery("");
    onMove(projectKey);
  };
  return (
    <Popover
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setQuery("");
        }
      }}
      open={open}
    >
      <PopoverTrigger asChild>
        <Button
          aria-expanded={open}
          aria-label={label}
          className="w-32 justify-between font-normal"
          role="combobox"
          size="sm"
          type="button"
          variant="outline"
        >
          <span className="text-muted-foreground">Move to...</span>
          <ChevronsUpDown aria-hidden="true" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-0">
        {/* The list is filtered here, by whole words anywhere in a title,
            rather than by cmdk's fuzzy match, which keeps titles that only
            share scattered letters with the query. */}
        <Command shouldFilter={false}>
          <CommandInput
            aria-label="Search projects"
            onValueChange={setQuery}
            placeholder="Search projects"
            value={query}
          />
          <CommandList>
            <CommandEmpty>No project matches.</CommandEmpty>
            <CommandGroup>
              {targets.map((p) => (
                <CommandItem
                  key={p.key}
                  onSelect={() => choose(p.key)}
                  value={p.key}
                >
                  {p.title}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
