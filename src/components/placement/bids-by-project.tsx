import { Pin, PinOff, TriangleAlert } from "lucide-react";
import { useMemo } from "react";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { RemoveStudentButton } from "#/components/placement/removed-students";
import type { PlacementWorkspace } from "#/components/placement/use-placement-workspace";
import { Button } from "#/components/ui/button";
import { ordinal } from "#/lib/placement/analytics";
import { type ProjectBidRow, projectBidRows } from "#/lib/placement/bids-view";
import type { PlacementStudent } from "#/lib/placement/types";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useLocalTableSearch } from "#/lib/use-local-table-search";

const DEFAULT_SORT: SortState = { desc: false, id: "student" };
const WARNING_STYLE = { color: "var(--status-warning)" };

function priorityLabel(row: ProjectBidRow): string {
  if (row.preApproved) {
    return "Pre-approved";
  }
  if (row.priority === null) {
    return "Pinned, not in their bids";
  }
  return row.pinnedHere
    ? `${ordinal(row.priority)}, pinned`
    : ordinal(row.priority);
}

/**
 * The Bids tab's per-project view (#671): each project's bidders with what
 * they wrote, and a pin to settle one there before any run. A pin here is
 * the same board pin the Results tab's Approve writes.
 */
export function BidsByProject({
  state,
  students,
}: {
  state: PlacementWorkspace;
  /** The students with every pin in effect applied. */
  students: PlacementStudent[];
}) {
  const { update } = state;
  const { navigate, search } = useLocalTableSearch();
  const rows = useMemo(
    () => projectBidRows(students, state.placementProjects),
    [students, state.placementProjects]
  );

  const columns = useMemo(() => {
    const pin = (email: string, projectKey: string | null) =>
      update((w) => ({ ...w, pins: { ...w.pins, [email]: projectKey } }));
    return defineAdminColumns<ProjectBidRow>()([
      {
        accessorFn: (row) => row.name || row.email,
        cell: ({ row }) =>
          row.original.empty ? (
            <span className="text-muted-foreground">No bids</span>
          ) : (
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
                    <span className="font-medium">
                      Prefers not to work with:
                    </span>{" "}
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
        accessorFn: (row) => (row.empty ? "" : priorityLabel(row)),
        cell: ({ row }) =>
          row.original.empty ? "-" : priorityLabel(row.original),
        enableSorting: false,
        header: "Priority",
        id: "priority",
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
      {
        cell: ({ row }) => {
          const r = row.original;
          if (r.empty) {
            return null;
          }
          const who = r.name || r.email;
          return (
            <div className="flex flex-col items-start gap-1">
              {r.pinnedHere ? (
                <Button
                  aria-label={`Unpin ${who}`}
                  onClick={() => pin(r.email, null)}
                  size="sm"
                  type="button"
                  variant="ghost"
                >
                  <PinOff aria-hidden="true" />
                  Unpin
                </Button>
              ) : (
                !r.fixed && (
                  <Button
                    aria-label={`Pin ${who} to ${r.projectTitle}`}
                    onClick={() => pin(r.email, r.projectKey)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    <Pin aria-hidden="true" />
                    Pin here
                  </Button>
                )
              )}
              {r.pinnedElsewhere && (
                <span className="text-muted-foreground text-xs">
                  Pinned to {r.pinnedElsewhere}
                </span>
              )}
              <RemoveStudentButton
                email={r.email}
                name={r.name}
                update={update}
              />
            </div>
          );
        },
        enableHiding: false,
        enableSorting: false,
        header: "Actions",
        id: "actions",
      },
    ]);
  }, [update]);

  const { tableProps } = useAdminTable({
    columns,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "placement-bids-by-project",
  });

  return (
    <div className="mt-4">
      <AdminDataTable
        caption="Each project's bidders, first choices first"
        data={rows}
        emptyMessage="No projects."
        getRowId={(row) => row.id}
        group={{
          header: (groupRows) => <ProjectHeader rows={groupRows} />,
          key: (row) => row.projectKey,
        }}
        {...tableProps}
      />
    </div>
  );
}

function ProjectHeader({ rows }: { rows: ProjectBidRow[] }) {
  const [first] = rows;
  const bidders = rows.filter((r) => !r.empty && r.priority !== null);
  const firstChoice = bidders.filter((r) => r.priority === 1).length;
  const pinned = rows.filter((r) => r.pinnedHere).length;
  return (
    <div>
      <span className="font-medium">{first.projectTitle}</span>
      <span className="ml-2 font-normal text-muted-foreground text-xs">
        {bidders.length} {bidders.length === 1 ? "bid" : "bids"}, {firstChoice}{" "}
        first {firstChoice === 1 ? "choice" : "choices"}
        {pinned > 0 && `, ${pinned} pinned`}
      </span>
      {first.fixed && (
        <p className="font-normal text-muted-foreground text-xs">
          Added from the roster: it holds only its pre-approved students, so it
          offers no Pin here.
        </p>
      )}
    </div>
  );
}
