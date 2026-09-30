import {
  ArrowRightLeft,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Download,
  FoldVertical,
  Pin,
  PinOff,
  Play,
  Square,
  TriangleAlert,
  UnfoldVertical,
} from "lucide-react";
import {
  createContext,
  useCallback,
  useContext,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { ErrorBanner } from "#/components/error-banner";
import { StudentMenu } from "#/components/placement/removed-students";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card } from "#/components/ui/card";
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
import {
  ordinal,
  percentDown,
  type TeamSizes,
  teamSizes,
} from "#/lib/placement/analytics";
import {
  applyPins,
  type BidOption,
  type BoardRow,
  bidOptions,
  bidsWithPinsCsv,
  boardRows,
  describeRun,
  foldKey,
  groupOpen,
  groupSummary,
  moveStudent,
  moveTargets,
  placementCsv,
  projectsWithoutTeam,
  removeFromResult,
  standingPreApprovals,
  UNPLACED_GROUP,
  type UnsurveyedRow,
  unplacedReason,
  unsurveyedRows,
} from "#/lib/placement/board";
import { downloadText } from "#/lib/placement/download";
import { runPlacement } from "#/lib/placement/run-placement";
import type {
  PlacementResult,
  PlacementStudent,
  WorkspaceProject,
} from "#/lib/placement/types";
import {
  isStale,
  toPlacementInput,
  type Workspace,
} from "#/lib/placement/workspace";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useLocalTableSearch } from "#/lib/use-local-table-search";

const DEFAULT_SORT: SortState = { desc: false, id: "student" };

const WARNING_STYLE = { color: "var(--status-warning)" };

const NO_FOLDS: ReadonlyMap<string, boolean> = new Map();

/**
 * The board groups opened or closed by hand (#713), by `foldKey`, for the run
 * they were set on: a new run starts every project over from its pins. In
 * component state only, never in the workspace.
 */
function useRunFolds(at: string) {
  const [folds, setFolds] = useState({ at, open: NO_FOLDS });
  const set = useCallback(
    (change: (open: Map<string, boolean>) => void) =>
      setFolds((prev) => {
        const next = new Map(prev.at === at ? prev.open : NO_FOLDS);
        change(next);
        return { at, open: next };
      }),
    [at]
  );
  return [folds.at === at ? folds.open : NO_FOLDS, set] as const;
}

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
  // The roster's pre-approvals no board pin has replaced, which keep a
  // student off the not-in-the-survey list (#714).
  const preApproved = useMemo(
    () => standingPreApprovals(bids?.students ?? [], workspace.pins),
    [bids, workspace.pins]
  );
  const titles = useMemo(
    () => new Map(allProjects.map((p) => [p.key, p.title])),
    [allProjects]
  );
  const { fingerprint } = state;
  const [running, setRunning] = useState(false);
  // A failed run, and the inputs it read: it stops being shown once they
  // change, since its diagnostics may no longer hold.
  const [failed, setFailed] = useState<{
    fingerprint: string;
    result: PlacementResult;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  // Which students show their bids (#687): here rather than in the board,
  // which unmounts when a new file clears the result, so they stay open for
  // as long as the page does. Never in the workspace, and by email, so a
  // student stays open after Move here takes them to another group.
  const [openBids, setOpenBids] = useState<ReadonlySet<string>>(
    () => new Set()
  );
  const toggleBids = useCallback(
    (email: string) =>
      setOpenBids((prev) => {
        const next = new Set(prev);
        if (!next.delete(email)) {
          next.add(email);
        }
        return next;
      }),
    []
  );

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
          openBids={openBids}
          preApproved={preApproved}
          projects={allProjects}
          result={result}
          rows={rows}
          // After a failed run the alert above says what to do; "run again"
          // would tell the reader to repeat what just failed (#680).
          stale={failure === null && isStale(result, fingerprint)}
          students={students}
          titles={titles}
          toggleBids={toggleBids}
          update={update}
          workspace={workspace}
        />
      )}
    </div>
  );
}

/**
 * The run's headline numbers (#701), read from the board as it stands, so a
 * Move or a removal changes them at once.
 */
function Figures({
  first,
  placed,
  sizes,
  total,
}: {
  first: number;
  placed: number;
  sizes: TeamSizes;
  total: number;
}) {
  const unplaced = total - placed;
  return (
    <section aria-label="Placement figures" className="mt-4">
      <dl className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <Figure
          hint={unplaced > 0 ? `${unplaced} unplaced` : null}
          label="Placed"
          value={
            <>
              {placed}{" "}
              <span className="font-normal text-base text-muted-foreground">
                of {total}
              </span>
            </>
          }
        />
        <Figure
          hint={placed > 0 ? `${percentDown(first, placed)}% of placed` : null}
          label="First choice"
          value={first}
        />
        <Figure
          hint={
            sizes.projects > 0
              ? `on ${sizes.projects} ${sizes.projects === 1 ? "project" : "projects"}`
              : null
          }
          label="Teams"
          value={sizes.teams}
        />
        <Figure
          hint={sizeRange(sizes.min, sizes.max)}
          label="Students per team"
          value={sizes.mean === null ? "-" : sizes.mean.toFixed(1)}
        />
      </dl>
    </section>
  );
}

/** Under the mean: "3 to 4", or "every team 4" when they are one size. */
function sizeRange(min: number | null, max: number | null): string | null {
  if (min === null || max === null) {
    return null;
  }
  return min === max ? `every team ${max}` : `${min} to ${max}`;
}

function Figure({
  hint,
  label,
  value,
}: {
  hint: string | null;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <Card className="p-4">
      <dt className="text-muted-foreground text-sm">{label}</dt>
      <dd className="mt-1 font-semibold text-2xl tabular-nums">{value}</dd>
      {hint && <dd className="mt-0.5 text-muted-foreground text-xs">{hint}</dd>}
    </Card>
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
  openBids,
  preApproved,
  projects,
  result,
  rows,
  stale,
  students,
  titles,
  toggleBids,
  update,
  workspace,
}: {
  /** The latest run failed, so this board is from an earlier one. */
  failed: boolean;
  openBids: ReadonlySet<string>;
  preApproved: ReadonlySet<string>;
  projects: WorkspaceProject[];
  result: NonNullable<Workspace["result"]>;
  rows: BoardRow[];
  stale: boolean;
  students: PlacementStudent[];
  titles: Map<string, string>;
  toggleBids: (email: string) => void;
  update: PlacementWorkspace["update"];
  workspace: Workspace;
}) {
  const { navigate, search } = useLocalTableSearch();
  const byEmail = useMemo(
    () => new Map(students.map((s) => [s.email, s])),
    [students]
  );
  const placed = rows.filter((r) => r.projectKey !== null);
  const first = placed.filter((r) => r.priority === 1).length;
  const empty = projectsWithoutTeam(
    result,
    projects,
    workspace.parameters.maxTeams
  );
  const sizes = teamSizes(rows);
  // Each group's rows, from every row on the board: whether a project is all
  // pinned never depends on what the table happens to render.
  const groups = useMemo(() => {
    const byKey = new Map<string, BoardRow[]>();
    for (const row of rows) {
      byKey.set(row.groupKey, [...(byKey.get(row.groupKey) ?? []), row]);
    }
    return byKey;
  }, [rows]);
  const [manual, setManual] = useRunFolds(result.at);
  const isOpen = (key: string) => groupOpen(groups.get(key) ?? [], manual);
  const setAll = (open: boolean) =>
    setManual((next) => {
      for (const [key, groupRows] of groups) {
        if (key !== UNPLACED_GROUP) {
          next.set(foldKey(groupRows[0]), open);
        }
      }
    });
  const notes = [
    // After a failed run the heading above already carries the time.
    ...(failed ? [] : [`Ran at ${new Date(result.at).toLocaleString()}.`]),
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

  const move = useCallback(
    (row: BoardRow, projectKey: string) => {
      // The bid's priority travels with the move, so the file and the row
      // both say which choice the new project was.
      const priority =
        byEmail.get(row.email)?.bids.find((b) => b.projectKey === projectKey)
          ?.priority ?? null;
      update((w) => ({
        ...w,
        pins: { ...w.pins, [row.email]: projectKey },
        result:
          w.result && moveStudent(w.result, row.email, projectKey, priority),
      }));
      // The student lands where the reader can see them, with their bids if
      // open, even when the move leaves every student there pinned. A Move is
      // a hand choice about that project, as its chevron is, so it holds
      // until the next run.
      setManual((next) => {
        next.set(projectKey, true);
      });
    },
    [byEmail, update, setManual]
  );

  const pin = useCallback(
    (email: string, projectKey: string | null) =>
      update((w) => ({ ...w, pins: { ...w.pins, [email]: projectKey } })),
    [update]
  );
  const unsurveyed = useMemo(
    () => unsurveyedRows(rows, preApproved),
    [rows, preApproved]
  );
  const columns = useMemo(() => {
    return defineAdminColumns<BoardRow>()([
      {
        accessorFn: (row) => row.name || row.email,
        cardHeader: true,
        cell: ({ row }) => (
          <div>
            <BidsToggle
              count={byEmail.get(row.original.email)?.bids.length ?? 0}
              email={row.original.email}
              who={row.original.name || row.original.email}
            />
            {/* Under the name, past the chevron in front of it. */}
            {row.original.name && (
              <div className="pl-5 text-muted-foreground text-xs">
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
        accessorFn: (row) => row.team ?? undefined,
        cell: ({ row }) => row.original.team ?? "-",
        enableSorting: false,
        header: "Team",
        id: "team",
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
  }, [update, move, pin, projects, workspace.parameters.maxTeams, byEmail]);
  const bidsState = useMemo(
    () => ({ open: openBids, toggle: toggleBids }),
    [openBids, toggleBids]
  );

  const { tableProps } = useAdminTable({
    columns,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "placement-results",
  });

  return (
    <OpenBids.Provider value={bidsState}>
      <div className="mt-4">
        {failed && (
          <h2 className="font-medium">
            Last run that worked, {new Date(result.at).toLocaleString()}
          </h2>
        )}
        <Figures
          first={first}
          placed={placed.length}
          sizes={sizes}
          total={rows.length}
        />
        {unsurveyed.length > 0 && (
          <Unsurveyed
            defaultMaxTeams={workspace.parameters.maxTeams}
            onMove={move}
            onPin={pin}
            projects={projects}
            unsurveyed={unsurveyed}
            update={update}
          />
        )}
        {/* Empty after a failed re-run of a clean placement: the heading
            above carries the time, and nothing else needs saying. */}
        {notes.length > 0 && <RunReport lines={notes} />}
        <p className="mt-2 text-muted-foreground text-sm">
          Approve pins a student to the project they are on for every later run,
          over any pin from the bids file or the roster; Pin here on the Bids
          tab does the same. Move puts the student on another project now and
          pins them there, so later runs keep them there. A student's name opens
          every project they bid on, under their row, with what they wrote for
          it, and Move here does what Move does for that project. A project
          whose students are all pinned folds to its header, since it needs
          nothing more; its chevron, or Expand all, opens it again, and a new
          run starts over. Unpin frees the student from every pin, and the next
          run places them by their bids. A pin changes the next run, not the
          placement shown here. Remove from placement, in a row's More menu,
          takes the student off this board and out of every run, not only their
          team, until you restore them on the Roster tab.
        </p>
        {empty.length > 0 && (
          <p className="mt-2 text-sm">
            No team formed: {empty.map((p) => p.title).join(", ")}.
          </p>
        )}
        <div className="mt-4">
          <AdminDataTable
            caption="Placement by project, unplaced students first"
            data={rows}
            detail={(row) =>
              openBids.has(row.email) ? (
                <BidsDetail
                  onMove={(key) => move(row, key)}
                  options={bidOptions(
                    byEmail.get(row.email)?.bids ?? [],
                    row.projectKey,
                    projects,
                    workspace.parameters.maxTeams
                  )}
                  row={row}
                />
              ) : null
            }
            emptyMessage="Nobody to place."
            getRowId={(row) => row.email}
            group={{
              collapse: {
                isOpen,
                label: (groupRows) => groupRows[0].groupLabel,
                onToggle: (key) =>
                  setManual((next) => {
                    const [head] = groups.get(key) ?? [];
                    if (head) {
                      next.set(foldKey(head), !isOpen(key));
                    }
                  }),
              },
              header: (groupRows) => <GroupHeader rows={groupRows} />,
              key: (row) => row.groupKey,
            }}
            toolbar={
              <div className="flex flex-wrap gap-2">
                <Button
                  onClick={() => setAll(true)}
                  type="button"
                  variant="outline"
                >
                  <UnfoldVertical aria-hidden="true" />
                  Expand all
                </Button>
                <Button
                  onClick={() => setAll(false)}
                  type="button"
                  variant="outline"
                >
                  <FoldVertical aria-hidden="true" />
                  Collapse all
                </Button>
              </div>
            }
            {...tableProps}
          />
        </div>
      </div>
    </OpenBids.Provider>
  );
}

/**
 * A group's header: the project, then its teams, students and pins, or that
 * every one of them is pinned. Unplaced gives its count alone.
 */
function GroupHeader({ rows }: { rows: BoardRow[] }) {
  const { allPinned, pinned, students, teams } = groupSummary(rows);
  const count = `${students} ${students === 1 ? "student" : "students"}`;
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
      {rows[0].groupLabel}
      <span className="font-normal text-muted-foreground text-xs">
        {rows[0].projectKey === null
          ? count
          : `${teams} ${teams === 1 ? "team" : "teams"}, ${count}${allPinned ? "" : `, ${pinned} pinned`}`}
      </span>
      {rows[0].projectKey !== null && allPinned && (
        <Badge variant="outline">All pinned</Badge>
      )}
    </span>
  );
}

const UNSURVEYED_SORT: SortState = { desc: false, id: "student" };

/**
 * The roster students who did not answer the survey and have no
 * pre-approval (#714), in one place: where each is, how many on their team
 * did answer, and the board's own actions. A team where one or none did is
 * where a student placed without bids most needs a look.
 */
function Unsurveyed({
  defaultMaxTeams,
  onMove,
  onPin,
  projects,
  unsurveyed,
  update,
}: {
  defaultMaxTeams: number;
  onMove: (row: BoardRow, projectKey: string) => void;
  onPin: (email: string, projectKey: string | null) => void;
  projects: WorkspaceProject[];
  unsurveyed: UnsurveyedRow[];
  update: PlacementWorkspace["update"];
}) {
  const [open, setOpen] = useState(true);
  const { navigate, search } = useLocalTableSearch();
  const bodyId = useId();
  const columns = useMemo(
    () =>
      defineAdminColumns<UnsurveyedRow>()([
        {
          accessorFn: (u) => u.row.name || u.row.email,
          cardHeader: true,
          cell: ({ row }) => (
            <div>
              <div>{row.original.row.name || row.original.row.email}</div>
              {row.original.row.name && (
                <div className="text-muted-foreground text-xs">
                  {row.original.row.email}
                </div>
              )}
            </div>
          ),
          enableHiding: false,
          enableSorting: false,
          header: "Student",
          id: "student",
        },
        {
          accessorFn: (u) => placedOn(u.row),
          cell: ({ row }) => placedOn(row.original.row),
          enableHiding: false,
          enableSorting: false,
          header: "Placed on",
          id: "placed",
        },
        {
          accessorFn: (u) => u.surveyed,
          cell: ({ row }) => <SurveyedCount unsurveyed={row.original} />,
          enableHiding: false,
          enableSorting: false,
          header: "Surveyed on the team",
          id: "surveyed",
        },
        {
          cell: ({ row }) => (
            <RowActions
              defaultMaxTeams={defaultMaxTeams}
              onMove={(key) => onMove(row.original.row, key)}
              onPin={(key) => onPin(row.original.row.email, key)}
              projects={projects}
              row={row.original.row}
              update={update}
            />
          ),
          enableHiding: false,
          enableSorting: false,
          header: "Actions",
          id: "actions",
        },
      ]),
    [defaultMaxTeams, onMove, onPin, projects, update]
  );
  const { tableProps } = useAdminTable({
    columns,
    defaultSort: UNSURVEYED_SORT,
    navigate,
    search,
    storageKey: "placement-unsurveyed",
  });
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <Card className="mt-4 p-4">
      <section aria-labelledby={`${bodyId}-heading`}>
        <h2 className="font-medium" id={`${bodyId}-heading`}>
          <Button
            aria-controls={open ? bodyId : undefined}
            aria-expanded={open}
            className="font-medium"
            onClick={() => setOpen((was) => !was)}
            size="bare"
            type="button"
            variant="ghost"
          >
            <Chevron aria-hidden="true" />
            Not in the survey
          </Button>{" "}
          <span className="font-normal text-muted-foreground text-sm">
            {unsurveyed.length}{" "}
            {unsurveyed.length === 1 ? "student" : "students"}
          </span>
        </h2>
        {open && (
          <div id={bodyId}>
            <p className="mt-1 text-muted-foreground text-sm">
              On the roster with no bids and no pre-approval, so the run placed
              them where a team needed people. The count is how many on their
              team answered the survey; one or none is marked, since that team
              was formed with the least to go on. Approve, Move and Unpin work
              as they do on the board, and a student stays here once pinned.
            </p>
            <AdminDataTable
              caption="Students not in the survey, and where each is placed"
              data={unsurveyed}
              emptyMessage="Everyone answered the survey."
              getRowId={(u) => u.row.email}
              {...tableProps}
            />
          </div>
        )}
      </section>
    </Card>
  );
}

/** "Robot Arm, team 2", with ", pinned" once pinned there, or "Unplaced". */
function placedOn(row: BoardRow): string {
  if (row.projectKey === null) {
    return "Unplaced";
  }
  return `${row.groupLabel}, team ${row.team}${row.pinned ? ", pinned" : ""}`;
}

function SurveyedCount({ unsurveyed }: { unsurveyed: UnsurveyedRow }) {
  if (unsurveyed.teamSize === 0) {
    return "-";
  }
  const text = `${unsurveyed.surveyed} of ${unsurveyed.teamSize}`;
  if (unsurveyed.surveyed > 1) {
    return text;
  }
  return (
    <span className="inline-flex items-center gap-1" style={WARNING_STYLE}>
      <TriangleAlert aria-hidden="true" className="size-3.5" />
      {text}
      <span className="sr-only">
        , {unsurveyed.surveyed === 0 ? "nobody" : "only one"} on the team
        answered the survey
      </span>
    </span>
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

/**
 * The students whose bids are open, read by each row's toggle through
 * context rather than through the board's columns: columns that changed as
 * a row opened would remount every cell, the toggle with its focus.
 */
const OpenBids = createContext<{
  open: ReadonlySet<string>;
  toggle: (email: string) => void;
}>({ open: new Set(), toggle: () => undefined });

/**
 * The student's name, which opens their bids under their row (#687): a
 * chevron in front of it, and no line of its own. The state is in
 * aria-expanded; the name starts with the visible text, so a voice command
 * for it matches, and adds the bid count the chevron does not show.
 */
function BidsToggle({
  count,
  email,
  who,
}: {
  count: number;
  email: string;
  who: string;
}) {
  const { open, toggle } = useContext(OpenBids);
  const expanded = open.has(email);
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <Button
      aria-controls={expanded ? detailId(email) : undefined}
      aria-expanded={expanded}
      aria-label={`${who}, ${count} ${count === 1 ? "bid" : "bids"}`}
      // Wraps as the text it replaced did: a long name, or an email standing
      // in for one, stays inside a 375px card.
      className="wrap-anywhere items-start whitespace-normal text-left font-normal"
      onClick={() => toggle(email)}
      size="bare"
      type="button"
      variant="ghost"
    >
      <Chevron aria-hidden="true" className="mt-0.5" />
      {who}
    </Button>
  );
}

const detailId = (email: string) => `placement-bids-${email}`;

const MOVE_BLOCKED_LABEL: Record<
  Exclude<BidOption["state"], "placed" | "movable">,
  string
> = {
  no_teams: "No teams",
  roster_only: "Holds only its pre-approved students",
  not_listed: "Not on the Projects tab",
};

/** A student's bids under their row, each with Move here where it can. */
function BidsDetail({
  onMove,
  options,
  row,
}: {
  onMove: (projectKey: string) => void;
  options: BidOption[];
  row: BoardRow;
}) {
  const who = row.name || row.email;
  return (
    <section
      aria-label={`Bids of ${who}`}
      className="text-sm"
      id={detailId(row.email)}
    >
      {options.length === 0 ? (
        <p className="text-muted-foreground">
          {row.rosterOnly ? "Not in the survey; no bids." : "No bids."}
        </p>
      ) : (
        <ol className="divide-y">
          {options.map((o) => (
            <li
              className="flex flex-wrap items-start gap-x-3 gap-y-1 py-1.5 md:flex-nowrap"
              key={o.projectKey}
            >
              <span className="w-10 shrink-0 text-muted-foreground">
                {ordinal(o.priority)}
              </span>
              <div className="min-w-0 flex-1 basis-40">
                <div className="font-medium">{o.title}</div>
                <div className="whitespace-pre-line text-muted-foreground">
                  {o.comment || "No comment."}
                </div>
              </div>
              <div className="shrink-0">
                <BidAction onMove={onMove} option={o} who={who} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function BidAction({
  onMove,
  option,
  who,
}: {
  onMove: (projectKey: string) => void;
  option: BidOption;
  who: string;
}) {
  if (option.state === "placed") {
    return <span className="font-medium">Placed here</span>;
  }
  if (option.state === "movable") {
    return (
      <Button
        aria-label={`Move here: ${who} to ${option.title}`}
        onClick={() => onMove(option.projectKey)}
        size="sm"
        type="button"
        variant="outline"
      >
        <ArrowRightLeft aria-hidden="true" />
        Move here
      </Button>
    );
  }
  return (
    <span className="text-muted-foreground">
      {MOVE_BLOCKED_LABEL[option.state]}
    </span>
  );
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
      <StudentMenu email={row.email} name={row.name} update={update} />
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
