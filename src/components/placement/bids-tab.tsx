import { Trash2 } from "lucide-react";
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
import { BIDS_FORMAT } from "#/lib/placement/formats";
import type { PlacementStudent } from "#/lib/placement/types";
import type { Workspace } from "#/lib/placement/workspace";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useLocalTableSearch } from "#/lib/use-local-table-search";

const DEFAULT_SORT: SortState = { desc: false, id: "student" };

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
          One row per bid, exported from the bidding survey.
        </p>
        <FilePickerButton
          accept=".csv,text/csv"
          inputLabel="Bids CSV file"
          onText={(text, filename) =>
            update((w) => ({ ...w, bids: { filename, text } }))
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
          description="The bids leave this workspace. Upload the file again to bring them back."
          onConfirm={() => update((w) => ({ ...w, bids: null }))}
          title={`Remove the bids from ${workspace.bids.filename}?`}
        >
          <Button size="sm" type="button" variant="ghost">
            <Trash2 aria-hidden="true" />
            Remove bids
          </Button>
        </ConfirmDialog>
      </div>
      <ImportIssues issues={bids.issues} label="bids" />
      <StudentsTable projects={workspace.projects} students={students} />
    </div>
  );
}

interface Row {
  avoid: string | undefined;
  bidCount: number;
  email: string;
  firstChoice: string | undefined;
  name: string;
  pinnedTo: string | undefined;
}

function StudentsTable({
  projects,
  students,
}: {
  projects: Workspace["projects"];
  students: PlacementStudent[];
}) {
  const { navigate, search } = useLocalTableSearch();
  const titles = useMemo(
    () => new Map(projects.map((p) => [p.key, p.title])),
    [projects]
  );
  const rows: Row[] = students.map((s) => {
    const first = s.bids.reduce<(typeof s.bids)[number] | undefined>(
      (best, bid) =>
        best === undefined || bid.priority < best.priority ? bid : best,
      undefined
    );
    return {
      email: s.email,
      name: s.name,
      bidCount: s.bids.length,
      firstChoice: first && titles.get(first.projectKey),
      pinnedTo: s.pin && titles.get(s.pin),
      avoid: s.avoid,
    };
  });
  const columns = useMemo(
    () =>
      defineAdminColumns<Row>()([
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
            </div>
          ),
          enableHiding: false,
          header: "Student",
          id: "student",
        },
        {
          accessorFn: (row) => row.bidCount,
          cell: ({ row }) => row.original.bidCount,
          header: "Bids",
          id: "bidCount",
          sortFn: "basic",
        },
        {
          accessorFn: (row) => row.firstChoice,
          cell: ({ row }) => row.original.firstChoice ?? "-",
          header: "First choice",
          id: "firstChoice",
          sortUndefined: "last",
        },
        {
          accessorFn: (row) => row.pinnedTo,
          cell: ({ row }) => row.original.pinnedTo ?? "-",
          header: "Pinned to",
          id: "pinnedTo",
          sortUndefined: "last",
        },
        {
          accessorFn: (row) => row.avoid,
          cell: ({ row }) => row.original.avoid ?? "-",
          header: "Prefers not to work with",
          id: "avoid",
          sortUndefined: "last",
        },
      ]),
    []
  );
  const { tableProps } = useAdminTable({
    columns,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "placement-bids",
  });
  return (
    <div className="mt-4">
      <AdminDataTable
        caption="Students and their bids"
        data={rows}
        emptyMessage="No rows in the file could be used."
        getRowId={(row) => row.email}
        {...tableProps}
      />
    </div>
  );
}
