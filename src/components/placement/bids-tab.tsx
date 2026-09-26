import { Download, Trash2, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { ConfirmDialog } from "#/components/confirm-dialog";
import { CsvFormatHelp } from "#/components/placement/csv-format";
import { FilePickerButton } from "#/components/placement/file-picker-button";
import { ImportIssues } from "#/components/placement/import-issues";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { downloadText } from "#/lib/placement/download";
import { BIDS_FORMAT } from "#/lib/placement/formats";
import { convertQualtrics, isQualtricsExport } from "#/lib/placement/qualtrics";
import type { PlacementStudent } from "#/lib/placement/types";
import type { Workspace } from "#/lib/placement/workspace";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useLocalTableSearch } from "#/lib/use-local-table-search";

const DEFAULT_SORT: SortState = { desc: false, id: "priority" };

export function BidsTab({
  state,
  workspace,
}: {
  state: PlacementWorkspace;
  workspace: Workspace;
}) {
  const { bids, update } = state;

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
      </div>
    );
  }

  const { students } = bids;
  const bidCount = students.reduce((sum, s) => sum + s.bids.length, 0);
  const pinned = students.filter((s) => s.pin !== undefined).length;
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          {students.length} students and {bidCount} bids from{" "}
          {workspace.bids.filename}
          {pinned > 0 && `, ${pinned} pinned`}.
        </p>
        <ConfirmDialog
          busyLabel="Removing..."
          confirmLabel="Remove"
          description="The bids leave this workspace, and with them any placement and the pins set on it. Upload the file again to bring the bids back."
          onConfirm={() =>
            update((w) => ({
              ...w,
              bids: null,
              pins: undefined,
              result: undefined,
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
      <ImportIssues issues={bids.issues} label="bids" />
      <StudentsTable projects={workspace.projects} students={students} />
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
  priority: number | null;
  project: string;
}

const byName = (a: PlacementStudent, b: PlacementStudent) =>
  (a.name || a.email).localeCompare(b.name || b.email) ||
  a.email.localeCompare(b.email);

/** Every student's bids, first choice first, students in name order. */
function bidRows(
  students: PlacementStudent[],
  titles: Map<string, string>
): Row[] {
  return [...students].sort(byName).flatMap((s) => {
    const title = (key: string) => titles.get(key) ?? key;
    const student = { email: s.email, name: s.name, avoid: s.avoid };
    const rows: Row[] = [...s.bids]
      .sort((a, b) => a.priority - b.priority)
      .map((bid) => ({
        ...student,
        id: `${s.email}:${bid.projectKey}`,
        priority: bid.priority,
        project: title(bid.projectKey),
        comment: bid.comment,
        pinned: bid.projectKey === s.pin,
      }));
    if (s.pin !== undefined && !s.bids.some((b) => b.projectKey === s.pin)) {
      rows.push({
        ...student,
        id: `${s.email}:${s.pin}`,
        priority: null,
        project: title(s.pin),
        comment: "",
        pinned: true,
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
    cell: ({ row }) => row.original.priority ?? "Pinned",
    enableHiding: false,
    enableSorting: false,
    header: "Priority",
    id: "priority",
  },
  {
    accessorFn: (row) => row.project,
    cell: ({ row }) =>
      row.original.pinned ? (
        <span>
          {row.original.project}{" "}
          <span className="text-muted-foreground text-xs">(pinned)</span>
        </span>
      ) : (
        row.original.project
      ),
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

function StudentHeader({ rows }: { rows: Row[] }) {
  const [first] = rows;
  const bids = rows.filter((r) => r.priority !== null).length;
  return (
    <div>
      <span className="font-medium">{first.name || first.email}</span>
      {first.name && (
        <span className="ml-2 font-normal text-muted-foreground text-xs">
          {first.email}
        </span>
      )}
      <span className="ml-2 font-normal text-muted-foreground text-xs">
        {bids} {bids === 1 ? "bid" : "bids"}
      </span>
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

function StudentsTable({
  projects,
  students,
}: {
  projects: Workspace["projects"];
  students: PlacementStudent[];
}) {
  const { navigate, search } = useLocalTableSearch();
  const rows = useMemo(
    () => bidRows(students, new Map(projects.map((p) => [p.key, p.title]))),
    [projects, students]
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
          header: (groupRows) => <StudentHeader rows={groupRows} />,
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
