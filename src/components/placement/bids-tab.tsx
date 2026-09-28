import { Download, Trash2, TriangleAlert } from "lucide-react";
import { useId, useMemo } from "react";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { ConfirmDialog } from "#/components/confirm-dialog";
import { FilterSwitch } from "#/components/filter-switch";
import { BidsByProject } from "#/components/placement/bids-by-project";
import { CsvFormatHelp } from "#/components/placement/csv-format";
import { FilePickerButton } from "#/components/placement/file-picker-button";
import { ImportIssues } from "#/components/placement/import-issues";
import {
  RemovedStudents,
  RemoveStudentButton,
} from "#/components/placement/removed-students";
import { RosterSection } from "#/components/placement/roster-section";
import { TitleMatchesPanel } from "#/components/placement/title-matches";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { standingText, studentStanding } from "#/lib/placement/bids-view";
import { applyPins } from "#/lib/placement/board";
import { downloadText } from "#/lib/placement/download";
import { BIDS_FORMAT } from "#/lib/placement/formats";
import { convertQualtrics, isQualtricsExport } from "#/lib/placement/qualtrics";
import { repointRosterPins } from "#/lib/placement/roster";
import type { PlacementStudent } from "#/lib/placement/types";
import {
  isStale,
  type StoredResult,
  type Workspace,
} from "#/lib/placement/workspace";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useLocalTableSearch } from "#/lib/use-local-table-search";

const DEFAULT_SORT: SortState = { desc: false, id: "priority" };
const WARNING_STYLE = { color: "var(--status-warning)" };

export type BidsView = "project" | "student";

export function BidsTab({
  onPinnedOnly,
  onView,
  pinnedOnly,
  state,
  view,
  workspace,
}: {
  onPinnedOnly: (pinnedOnly: boolean) => void;
  onView: (view: BidsView) => void;
  pinnedOnly: boolean;
  state: PlacementWorkspace;
  view: BidsView;
  workspace: Workspace;
}) {
  const { bids, update } = state;
  const pinnedOnlyId = useId();

  if (workspace.projects.length === 0) {
    return (
      <p className="text-sm">
        Load the projects first, on the Projects tab: each bid names its project
        by title, and is matched against that list.
      </p>
    );
  }

  if (workspace.bids === null || bids === null) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p className="text-muted-foreground text-sm">
          One row per bid, or the bidding survey's Qualtrics export as it comes,
          which is converted to one row per bid on upload.
        </p>
        <FilePickerButton
          accept=".csv,text/csv"
          inputLabel="Bids CSV file"
          onText={(text, filename) =>
            // A new bids file starts the board over: its pins and result
            // were about the students of the old one.
            update((w) => ({
              ...w,
              bids: bidsFromFile(text, filename, w.projects),
              pins: undefined,
              result: undefined,
            }))
          }
        >
          Upload bids CSV
        </FilePickerButton>
        <CsvFormatHelp format={BIDS_FORMAT} label="bids" />
        <RosterSection state={state} workspace={workspace} />
      </div>
    );
  }

  const { students } = bids;
  const bidCount = students.reduce((sum, s) => sum + s.bids.length, 0);
  // Both views and the count show every pin in effect, the board's
  // included, so a pin set here or on the Results tab shows the same
  // everywhere (#671).
  const withPins = applyPins(students, workspace.pins);
  // What the roster pre-approved, before board pins, so a pre-approval a
  // board pin overrode can say so rather than vanish.
  const preApprovals = new Map(
    students.flatMap((s) =>
      s.preApproved && s.pin !== undefined ? [[s.email, s.pin] as const] : []
    )
  );
  const pinnedCount = withPins.filter((s) => s.pin !== undefined).length;
  const rosterOnly = students.filter((s) => s.rosterOnly).length;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {students.length - rosterOnly} students and {bidCount} bids from{" "}
          {workspace.bids.filename}
          {pinnedCount > 0 && `, ${pinnedCount} pinned`}
          {rosterOnly > 0 &&
            `, and ${rosterOnly} more from the roster with no bids`}
          .
        </p>
        <ConfirmDialog
          busyLabel="Removing..."
          confirmLabel="Remove"
          description="The bids leave this workspace, and with them any placement, the pins set on it and the titles matched by hand. Upload the file again to bring the bids back."
          onConfirm={() =>
            update((w) => ({
              ...w,
              bids: null,
              pins: undefined,
              result: undefined,
              titleMatches: undefined,
            }))
          }
          title={`Remove the bids from ${workspace.bids.filename}?`}
        >
          <Button size="sm" type="button" variant="ghost">
            <Trash2 aria-hidden="true" />
            Remove bids
          </Button>
        </ConfirmDialog>
      </div>
      {workspace.bids.convertedFrom !== undefined && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <span>
            Converted from the Qualtrics export {workspace.bids.convertedFrom}.
          </span>
          <Button
            onClick={() =>
              downloadText(
                workspace.bids?.filename ?? "bids.csv",
                workspace.bids?.text ?? "",
                "text/csv"
              )
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Download aria-hidden="true" />
            Download converted CSV
          </Button>
        </div>
      )}
      <ImportIssues
        issues={workspace.bids.conversionIssues ?? []}
        label="survey export"
      />
      <TitleMatchesPanel
        matches={workspace.titleMatches}
        onMatch={(added) =>
          update((w) => ({
            ...w,
            titleMatches: { ...w.titleMatches, ...added },
            pins: repointRosterPins(w.pins, added),
          }))
        }
        onUndo={(key) =>
          update((w) => {
            const { [key]: _undone, ...rest } = w.titleMatches ?? {};
            return {
              ...w,
              titleMatches: Object.keys(rest).length > 0 ? rest : undefined,
            };
          })
        }
        projects={workspace.projects}
        unmatched={bids.unmatched}
      />
      {/* A survey export that could not be converted leaves an empty file,
          whose missing columns would only repeat that (#681). */}
      {!workspace.bids.conversionIssues?.some((i) => i.wholeFile) && (
        <ImportIssues issues={bids.issues} label="bids" />
      )}
      <RosterSection state={state} workspace={workspace} />
      <RemovedStudents removed={bids.removed} update={update} />
      <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-2">
        <ViewSwitch onView={onView} view={view} />
        {view === "project" && (
          <FilterSwitch
            checked={pinnedOnly}
            id={pinnedOnlyId}
            label="Pinned only"
            onCheckedChange={onPinnedOnly}
          />
        )}
      </div>
      <p className="mt-2 text-muted-foreground text-sm">
        {view === "project"
          ? "Pin here does what Approve does on the Results tab: every run keeps the student on that project until you unpin them, over any pin from the bids file or the roster. Unpin frees them from all of these. A pin changes the next run; the Results tab shows the last run until then. Each project lists who is pinned there and how, and after a run how many the run placed there, each marked Placed here with their team; Pinned only shows the pinned students alone."
          : "Pinned rows show every pin in effect: the bids file's, the roster's, and those set here or on the Results tab, which win over the other two. Each student says where they stand: a pinned student stays on their pin in every run, so only the pin shows; anyone else shows where the last run placed them, marked in their rows."}{" "}
        Remove from placement takes a student out of every run, and off the
        board at once, until you restore them from the removed list above.
      </p>
      {view === "project" ? (
        <BidsByProject
          pinnedOnly={pinnedOnly}
          result={workspace.result}
          stale={isStale(workspace.result, state.fingerprint)}
          state={state}
          students={withPins}
        />
      ) : (
        <StudentsTable
          preApprovals={preApprovals}
          projects={state.placementProjects}
          result={workspace.result}
          stale={isStale(workspace.result, state.fingerprint)}
          students={withPins}
          update={update}
        />
      )}
    </div>
  );
}

/**
 * One bid, carrying its student, because a group header only sees its rows.
 * A pin to a project outside the student's bids is a row of its own with no
 * priority, so a student pinned there and bidding nothing still shows.
 */
interface Row {
  avoid: string | undefined;
  comment: string;
  email: string;
  id: string;
  name: string;
  pinned: boolean;
  /** The bid the last run placed an unpinned student on (#689). */
  placed: boolean;
  /** A pre-approval a pin set on the board overrides, by title. */
  preApprovalOverridden: string | null;
  /** The project the roster pre-approves the student for, by title. */
  preApprovedFor: string | null;
  priority: number | null;
  project: string;
  /** The one row of a roster student who did not answer the survey. */
  rosterOnly: boolean;
  /** Where the student stands, as their header says it (#689). */
  standing: string;
}

// The survey's students first, then the roster's, each in name order.
const byName = (a: PlacementStudent, b: PlacementStudent) =>
  Number(a.rosterOnly ?? false) - Number(b.rosterOnly ?? false) ||
  (a.name || a.email).localeCompare(b.name || b.email) ||
  a.email.localeCompare(b.email);

/**
 * Every student's bids, first choice first, students in name order. A
 * roster student who did not answer the survey gets one row saying so, since
 * a group needs a row to show.
 */
function bidRows(
  students: PlacementStudent[],
  titles: Map<string, string>,
  preApprovals: ReadonlyMap<string, string>,
  result: StoredResult | undefined,
  stale: boolean
): Row[] {
  return [...students].sort(byName).flatMap((s) => {
    const title = (key: string) => titles.get(key) ?? key;
    const standing = studentStanding(s, result);
    const placedOn = standing.kind === "placed" ? standing.projectKey : null;
    const student = {
      email: s.email,
      name: s.name,
      avoid: s.avoid,
      preApprovedFor:
        s.preApproved && s.pin !== undefined ? title(s.pin) : null,
      preApprovalOverridden: overriddenPreApproval(s, preApprovals, title),
      standing: standingText(standing, titles, stale),
    };
    const rows: Row[] = [...s.bids]
      .sort((a, b) => a.priority - b.priority)
      .map((bid) => ({
        ...student,
        id: `${s.email}:${bid.projectKey}`,
        priority: bid.priority,
        project: title(bid.projectKey),
        comment: bid.comment,
        pinned: bid.projectKey === s.pin,
        placed: bid.projectKey === placedOn,
        rosterOnly: false,
      }));
    if (s.pin !== undefined && !s.bids.some((b) => b.projectKey === s.pin)) {
      rows.push({
        ...student,
        id: `${s.email}:${s.pin}`,
        priority: null,
        project: title(s.pin),
        comment: "",
        pinned: true,
        placed: false,
        rosterOnly: false,
      });
    }
    if (rows.length === 0 && s.rosterOnly) {
      rows.push({
        ...student,
        id: `${s.email}:roster`,
        priority: null,
        project: "No bids",
        comment: "",
        pinned: false,
        placed: false,
        rosterOnly: true,
      });
    }
    return rows;
  });
}

// The rows arrive in a fixed order and nothing sorts, which keeps every
// student's group together (UI-CONVENTIONS, "Grouping rows that arrived
// together"). The sort below is inert.
const COLUMNS = defineAdminColumns<Row>()([
  {
    accessorFn: (row) => (row.priority === null ? "Pin" : String(row.priority)),
    cell: ({ row }) => {
      if (row.original.priority !== null) {
        return row.original.priority;
      }
      return row.original.pinned ? "Pinned" : "-";
    },
    enableHiding: false,
    enableSorting: false,
    header: "Priority",
    id: "priority",
  },
  {
    accessorFn: (row) => row.project,
    cell: ({ row }) => {
      let mark: string | null = null;
      if (row.original.pinned) {
        mark = "(pinned)";
      } else if (row.original.placed) {
        mark = "(placed)";
      }
      return mark === null ? (
        row.original.project
      ) : (
        <span>
          {row.original.project}{" "}
          <span className="text-muted-foreground text-xs">{mark}</span>
        </span>
      );
    },
    enableHiding: false,
    enableSorting: false,
    header: "Project",
    id: "project",
  },
  {
    accessorFn: (row) => row.comment || undefined,
    cell: ({ row }) => (
      <div className="whitespace-pre-line md:min-w-xs md:max-w-xl">
        {row.original.comment || "-"}
      </div>
    ),
    enableSorting: false,
    header: "Comment",
    id: "comment",
  },
]);

function StudentHeader({
  rows,
  update,
}: {
  rows: Row[];
  update: PlacementWorkspace["update"];
}) {
  const [first] = rows;
  const bids = rows.filter((r) => r.priority !== null).length;
  return (
    // A long email breaks rather than running past a 375px screen.
    <div className="wrap-anywhere">
      <span className="font-medium">{first.name || first.email}</span>
      {first.name && (
        <span className="ml-2 font-normal text-muted-foreground text-xs">
          {first.email}
        </span>
      )}
      <span className="ml-2 font-normal text-muted-foreground text-xs">
        {first.rosterOnly
          ? "on the roster, not in the survey"
          : `${bids} ${bids === 1 ? "bid" : "bids"}`}
      </span>
      <span className="ml-2 font-normal">
        <RemoveStudentButton
          email={first.email}
          name={first.name}
          update={update}
        />
      </span>
      {first.preApprovedFor && (
        <span className="ml-2 font-normal text-xs">
          pre-approved for {first.preApprovedFor}
        </span>
      )}
      <p className="font-normal text-sm">{first.standing}</p>
      {first.preApprovalOverridden && (
        <p className="font-normal text-sm" role="note" style={WARNING_STYLE}>
          Pre-approved for {first.preApprovalOverridden} on the roster, but a
          pin set on the Results tab or here replaces it. Unpin leaves them
          free; a pin to {first.preApprovalOverridden} puts them back there.
        </p>
      )}
      {first.avoid && (
        <p
          className="flex items-start gap-1 font-normal text-sm"
          role="note"
          style={{ color: "var(--status-warning)" }}
        >
          <TriangleAlert
            aria-hidden="true"
            className="mt-0.5 size-3.5 shrink-0"
          />
          <span>Prefers not to work with: {first.avoid}</span>
        </p>
      )}
    </div>
  );
}

/**
 * The title of the project the roster pre-approved the student for, when a
 * pin set on the board has since replaced that pre-approval.
 */
function overriddenPreApproval(
  student: PlacementStudent,
  preApprovals: ReadonlyMap<string, string>,
  title: (key: string) => string
): string | null {
  const key = preApprovals.get(student.email);
  return key !== undefined && !student.preApproved ? title(key) : null;
}

function StudentsTable({
  preApprovals,
  projects,
  result,
  stale,
  students,
  update,
}: {
  preApprovals: ReadonlyMap<string, string>;
  projects: Workspace["projects"];
  /** The last run, for where each student stands. */
  result: StoredResult | undefined;
  /** The projects, parameters or bids changed since that run. */
  stale: boolean;
  students: PlacementStudent[];
  update: PlacementWorkspace["update"];
}) {
  const { navigate, search } = useLocalTableSearch();
  const rows = useMemo(
    () =>
      bidRows(
        students,
        new Map(projects.map((p) => [p.key, p.title])),
        preApprovals,
        result,
        stale
      ),
    [projects, students, preApprovals, result, stale]
  );
  const { tableProps } = useAdminTable({
    columns: COLUMNS,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "placement-bids",
  });
  return (
    <div className="mt-4">
      <AdminDataTable
        caption="Each student's bids, first choice first"
        data={rows}
        emptyMessage="No rows in the file could be used."
        getRowId={(row) => row.id}
        group={{
          header: (groupRows) => (
            <StudentHeader rows={groupRows} update={update} />
          ),
          key: (row) => row.email,
        }}
        {...tableProps}
      />
    </div>
  );
}

const CSV_EXTENSION = /(\.csv)?$/i;

/**
 * What the workspace keeps for an uploaded bids file: the file as it came,
 * or, for a Qualtrics export, the long CSV it converts to plus what the
 * conversion noticed (#656).
 */
function bidsFromFile(
  text: string,
  filename: string,
  projects: Workspace["projects"]
): NonNullable<Workspace["bids"]> {
  if (!isQualtricsExport(text)) {
    return { filename, text };
  }
  const converted = convertQualtrics(text, projects);
  return {
    filename: filename.replace(CSV_EXTENSION, " (converted).csv"),
    text: converted.csv,
    convertedFrom: filename,
    conversionIssues: converted.issues,
  };
}

/**
 * Per student or per project; the choice lives in the URL. Built as
 * `ViewToggle` is: a segmented group whose pressed fill comes from
 * `aria-pressed` in the Button base class (UI-CONVENTIONS, "`className` on a
 * Button never restyles it").
 */
function ViewSwitch({
  onView,
  view,
}: {
  onView: (view: BidsView) => void;
  view: BidsView;
}) {
  const options: { label: string; value: BidsView }[] = [
    { value: "student", label: "Per student" },
    { value: "project", label: "Per project" },
  ];
  return (
    // biome-ignore lint/a11y/useSemanticElements: aria role=group with label is the right pattern for paired toggle buttons
    <div
      aria-label="Show the bids"
      className="flex [&>*+*]:-ml-px [&>*:not(:first-child)]:rounded-l-none [&>*:not(:last-child)]:rounded-r-none"
      role="group"
    >
      {options.map((option) => (
        <Button
          aria-pressed={view === option.value}
          key={option.value}
          onClick={() => onView(option.value)}
          size="sm"
          type="button"
          variant="outline"
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}
