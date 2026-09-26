import {
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
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { ordinal } from "#/lib/placement/analytics";
import {
  applyPins,
  type BoardRow,
  bidsWithPinsCsv,
  boardRows,
  describeRun,
  moveStudent,
  placementCsv,
  projectsWithoutTeam,
  unplacedReason,
} from "#/lib/placement/board";
import { downloadText } from "#/lib/placement/download";
import { runPlacement } from "#/lib/placement/run-placement";
import type { PlacementResult, PlacementStudent } from "#/lib/placement/types";
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
  const students = useMemo(
    () => applyPins(bids?.students ?? [], workspace.pins),
    [bids, workspace.pins]
  );
  const titles = useMemo(
    () => new Map(workspace.projects.map((p) => [p.key, p.title])),
    [workspace.projects]
  );
  // Hashes the whole bids text, and this panel stays mounted while other
  // tabs are edited, so it is worked out once per change to its inputs.
  const { projects, parameters, bids: stored, titleMatches } = workspace;
  const fingerprint = useMemo(
    () =>
      inputFingerprint({ projects, parameters, bids: stored, titleMatches }),
    [projects, parameters, stored, titleMatches]
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
        toPlacementInput(workspace, students),
        controller.signal
      );
      const usable =
        (result.status === "optimal" || result.status === "time_limit") &&
        result.placements.length > 0;
      if (usable) {
        setFailed(null);
        update((w) => ({
          ...w,
          result: {
            ...result,
            at: new Date().toISOString(),
            fingerprint: read,
          },
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
  const rows = useMemo(
    () => (result ? boardRows(result, students, workspace.projects) : []),
    [result, students, workspace.projects]
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
      {failed && failed.fingerprint === fingerprint && (
        <RunReport
          lines={[
            ...describeRun(failed.result, titles),
            ...(result
              ? ["The placement below is from the last run that worked."]
              : []),
          ]}
          problem
        />
      )}
      {result && (
        <Board
          result={result}
          rows={rows}
          stale={result.fingerprint !== fingerprint}
          students={students}
          titles={titles}
          update={update}
          workspace={workspace}
        />
      )}
    </div>
  );
}

function RunReport({ lines, problem }: { lines: string[]; problem: boolean }) {
  return (
    <section
      aria-label="How the run went"
      className={`mt-4 rounded-md border px-3 py-2 text-sm ${problem ? "border-destructive/40" : ""}`}
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
  result,
  rows,
  stale,
  students,
  titles,
  update,
  workspace,
}: {
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
    workspace.projects,
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
          "Students were moved by hand since this run; run again to balance the teams.",
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
            projects={workspace.projects}
            row={row.original}
          />
        ),
        enableHiding: false,
        enableSorting: false,
        header: "Actions",
        id: "actions",
      },
    ]);
  }, [students, update, workspace.projects, workspace.parameters.maxTeams]);

  const { tableProps } = useAdminTable({
    columns,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "placement-results",
  });

  return (
    <div className="mt-4">
      <RunReport lines={notes} problem={false} />
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
  if (row.priority !== null) {
    return row.pinned
      ? `${ordinal(row.priority)}, pinned`
      : ordinal(row.priority);
  }
  return row.pinned ? "Pinned, not in their bids" : "Not in their bids";
}

function RowActions({
  defaultMaxTeams,
  onMove,
  onPin,
  projects,
  row,
}: {
  defaultMaxTeams: number;
  onMove: (projectKey: string) => void;
  onPin: (projectKey: string | null) => void;
  projects: Workspace["projects"];
  row: BoardRow;
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
      <Select onValueChange={onMove} value="">
        <SelectTrigger
          aria-label={`Move ${who}`}
          className="h-8 w-32"
          size="sm"
        >
          <SelectValue placeholder="Move to..." />
        </SelectTrigger>
        <SelectContent>
          {projects
            .filter(
              (p) =>
                p.key !== row.projectKey && (p.maxTeams ?? defaultMaxTeams) > 0
            )
            .map((p) => (
              <SelectItem key={p.key} value={p.key}>
                {p.title}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const today = () => new Date().toISOString().slice(0, 10);
