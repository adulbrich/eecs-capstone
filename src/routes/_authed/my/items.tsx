import { useQueryClient } from "@tanstack/react-query";
import {
  createFileRoute,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { LineSheet, type LineSheetField } from "#/components/line-sheet";
import { LocalTime } from "#/components/local-time";
import { NeedsAttention } from "#/components/my-items-attention";
import { OverdueBadge } from "#/components/overdue-badge";
import { SubmitBorrowListDialog } from "#/components/submit-borrow-list-dialog";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import { ListCount } from "#/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { DeadlineEntry } from "#/lib/inventory-deadlines";
import { deadlineOf } from "#/lib/inventory-deadlines";
import { lineTimeline } from "#/lib/inventory-timeline";
import {
  isOpenRow,
  MY_ITEMS_FILTERS,
  type MyItemsFilter,
  matchesMyItemsFilter,
} from "#/lib/my-items-filter";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import {
  cancelRequestItem,
  listMyItems,
  removeFromCart,
  submitCart,
} from "#/server/inventory";

// `filter` is the page's only search param. `sort` and `dir` are gone on
// purpose: no column here accepts a sort, so a URL naming one could only
// mislead, and sorting would drop the grouping and take the borrow list's
// Submit button, which lives on a group header, with it.
// Exported, with `buildColumns`, for `src/test/my-items-columns.test.tsx`,
// which pins the default filter and that no column can sort or hide.
export const searchSchema = z.object({
  filter: z.enum(MY_ITEMS_FILTERS).default("open"),
});

export const Route = createFileRoute("/_authed/my/items")({
  validateSearch: searchSchema,
  // No loaderDeps: the filter is applied in the browser over the viewer's
  // own rows, which are few, so changing it never refetches.
  loader: () => listMyItems(),
  component: MyItems,
});

type Row = Awaited<ReturnType<typeof listMyItems>>[number];

const FILTER_LABEL: Record<MyItemsFilter, string> = {
  all: "All",
  closed: "Closed",
  open: "Open",
};

const LINE_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  returned: "Returned",
};

function rowName(row: Row): string {
  return row.kind === "hold" ? row.item.name : row.itemName;
}

function rowId(row: Row): string {
  switch (row.kind) {
    case "cart":
      return `cart:${row.itemId}`;
    case "request":
      return row.line.id;
    case "hold":
      return `hold:${row.item.id}`;
    default: {
      const unhandled: never = row;
      throw new Error(`No row id for ${JSON.stringify(unhandled)}`);
    }
  }
}

/** The three kinds of group, keyed so a request's lines stay together. */
function groupKey(row: Row): string {
  switch (row.kind) {
    case "cart":
      return "cart";
    case "request":
      return `request:${row.requestId}`;
    case "hold":
      return "holds";
    default: {
      const unhandled: never = row;
      throw new Error(`No group for ${JSON.stringify(unhandled)}`);
    }
  }
}

/** A row the deadline rules can read: everything but the borrow list. */
function isDeadlineEntry(row: Row): row is Row & DeadlineEntry {
  return row.kind !== "cart";
}

function GroupHeader({ rows }: { rows: Row[] }) {
  const first = rows[0];
  const count = rows.length;
  switch (first.kind) {
    case "cart":
      return (
        <p>
          Not submitted yet
          <span className="font-normal text-muted-foreground">
            {" "}
            ({count} {count === 1 ? "item" : "items"})
          </span>
        </p>
      );
    case "request":
      return (
        <div className="space-y-0.5">
          <p>
            Requested
            <span className="font-normal text-muted-foreground">
              {" "}
              on <LocalTime dateOnly value={first.requestedAt} />, {count}{" "}
              {count === 1 ? "line" : "lines"}
            </span>
          </p>
          {first.note && (
            <p className="whitespace-pre-wrap font-normal text-muted-foreground text-xs">
              {first.note}
            </p>
          )}
        </div>
      );
    case "hold":
      return <p>Assigned to you by staff</p>;
    default: {
      const unhandled: never = first;
      throw new Error(`No header for ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The one date a borrower has to act on: the due date when something is
 * out, else the pickup deadline when something is waiting to be collected.
 */
function DeadlineCell({ row }: { row: Row }) {
  if (!(isDeadlineEntry(row) && isOpenRow(row))) {
    return <>-</>;
  }
  const pair = row.kind === "hold" ? row.item : row.line;
  if (pair.dueAt) {
    return (
      <>
        Due <LocalTime dateOnly value={pair.dueAt} />
      </>
    );
  }
  if (pair.pickupBy) {
    return (
      <>
        Pick up by <LocalTime dateOnly value={pair.pickupBy} />
      </>
    );
  }
  return <>-</>;
}

function StateCell({ row }: { row: Row }) {
  if (row.kind === "cart") {
    return <span className="text-muted-foreground">Not submitted</span>;
  }
  if (row.kind === "request" && !isOpenRow(row)) {
    return <>{LINE_STATUS_LABEL[row.line.status] ?? row.line.status}</>;
  }
  const status = row.kind === "hold" ? row.item.status : row.itemStatus;
  return (
    <span className="flex flex-wrap items-center gap-1">
      <InventoryStatusBadge status={status} />
      <OverdueBadge entry={row} />
    </span>
  );
}

function canCancel(row: Row): boolean {
  return (
    row.kind === "request" &&
    (row.line.status === "pending" || row.line.status === "approved") &&
    row.itemStatus !== "checked_out"
  );
}

interface Actions {
  busy: boolean;
  onCancel: (requestItemId: string) => void;
  onOpen: (id: string) => void;
  onRemove: (itemId: string) => void;
}

/**
 * Item, then state, then the date that matters, then what staff said. Every
 * column is unsortable and unhideable on purpose: a student's page carries
 * no admin machinery, and a sort would drop the grouping (see
 * `docs/QUIRKS.md`, Inventory).
 */
export function buildColumns({ busy, onCancel, onOpen, onRemove }: Actions) {
  return defineAdminColumns<Row>()([
    {
      accessorFn: (row) => rowName(row),
      cardHeader: true,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="font-medium">{rowName(row.original)}</p>
          {row.original.kind === "request" && row.original.collectedBy && (
            <p className="text-muted-foreground text-xs">
              Collected by{" "}
              {row.original.collectedBy.name ?? row.original.collectedBy.email}
            </p>
          )}
        </div>
      ),
      enableHiding: false,
      enableSorting: false,
      header: "Item",
      id: "item",
    },
    {
      accessorFn: (row) =>
        row.kind === "hold" ? row.item.status : row.itemStatus,
      cell: ({ row }) => <StateCell row={row.original} />,
      enableHiding: false,
      enableSorting: false,
      header: "State",
      id: "state",
    },
    {
      accessorFn: (row) =>
        isDeadlineEntry(row) ? (deadlineOf(row) ?? undefined) : undefined,
      cell: ({ row }) => <DeadlineCell row={row.original} />,
      enableHiding: false,
      enableSorting: false,
      header: "Deadline",
      id: "deadline",
      sortingFn: "datetime",
    },
    {
      accessorFn: (row) =>
        row.kind === "request"
          ? (row.line.closedReason ?? undefined)
          : undefined,
      cell: ({ row }) =>
        row.original.kind === "request"
          ? (row.original.line.closedReason ?? "-")
          : "-",
      enableHiding: false,
      enableSorting: false,
      header: "Note from staff",
      id: "note",
    },
    {
      cell: ({ row }) => {
        const entry = row.original;
        return (
          <div className="flex flex-wrap gap-2">
            {entry.kind !== "cart" && (
              <Button
                onClick={() => onOpen(rowId(entry))}
                size="sm"
                variant="outline"
              >
                Details
              </Button>
            )}
            {entry.kind === "cart" && (
              <Button
                disabled={busy}
                onClick={() => onRemove(entry.itemId)}
                size="sm"
                variant="ghost"
              >
                Remove
              </Button>
            )}
            {entry.kind === "request" && canCancel(entry) && (
              <Button
                disabled={busy}
                onClick={() => onCancel(entry.line.id)}
                size="sm"
                variant="outline"
              >
                Cancel
              </Button>
            )}
          </div>
        );
      },
      enableHiding: false,
      enableSorting: false,
      header: "Actions",
      id: "actions",
    },
  ]);
}

// Required by the hook and inert: no column can sort, so `parseSort` returns
// this fallback whatever the URL says, and the table stays grouped.
const DEFAULT_SORT: SortState = { desc: false, id: "item" };

// The table never navigates: nothing here sorts or hides, so the hook's two
// callbacks have no URL state to write. A no-op rather than the route's own
// `navigate`, whose search type requires `filter` and has no sort keys.
const noNavigate = () => undefined;

const NO_MATCH: Record<MyItemsFilter, string> = {
  all: "Nothing here.",
  closed: "No closed requests yet.",
  open: "Nothing open right now.",
};

function MyItems() {
  const data = Route.useLoaderData();
  const { filter } = Route.useSearch();
  const navigate = useNavigate({ from: "/my/items" });
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Memoised so the Actions column below, which closes over it, is rebuilt
  // only when `busy` flips rather than on every render.
  const run = useCallback(
    async (action: () => Promise<void>) => {
      setBusy(true);
      try {
        await action();
        await Promise.all([qc.invalidateQueries(), router.invalidate()]);
      } catch (e) {
        toast.error((e as Error)?.message || "That did not go through");
      } finally {
        setBusy(false);
      }
    },
    [qc, router]
  );

  const columns = useMemo(
    () =>
      buildColumns({
        busy,
        onCancel: (requestItemId) =>
          run(async () => {
            await cancelRequestItem({ data: { requestItemId, note: null } });
          }),
        onOpen: setOpenId,
        onRemove: (itemId) =>
          run(async () => {
            await removeFromCart({ data: { itemId } });
          }),
      }),
    [busy, run]
  );
  const { tableProps } = useAdminTable({
    columns,
    defaultSort: DEFAULT_SORT,
    navigate: noNavigate,
    // Nothing here sorts or hides, so the table has no URL state to read.
    search: {},
    storageKey: "my-items",
  });

  const rows = useMemo(
    () => data.filter((row) => matchesMyItemsFilter(row, filter)),
    [data, filter]
  );
  const attention = useMemo(
    () => data.filter(isDeadlineEntry).filter(isOpenRow),
    [data]
  );
  const openRow = openId
    ? (data.find((row) => rowId(row) === openId) ?? null)
    : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">My Items</h1>
      <NeedsAttention entries={attention} />
      <AdminDataTable
        caption="My items"
        data={rows}
        emptyMessage="Nothing here yet. Browse the inventory, add the items you need to your borrow list, and submit them here as one request."
        // A person with rows sees the filter even when it matched nothing; a
        // person with nothing at all sees the message alone.
        filtered={data.length > 0 && filter !== "all"}
        getRowId={rowId}
        group={{
          actions: (groupRows) =>
            groupRows[0].kind === "cart" ? (
              <SubmitBorrowListDialog
                busy={busy}
                count={groupRows.length}
                onSubmit={(note) =>
                  run(async () => {
                    const result = await submitCart({ data: { note } });
                    if (result.skipped.length > 0) {
                      toast.warning(
                        `Submitted ${result.submitted.length}, skipped ${result.skipped.length} (no longer available).`
                      );
                    }
                  })
                }
              />
            ) : null,
          header: (groupRows) => <GroupHeader rows={groupRows} />,
          key: groupKey,
        }}
        noMatchMessage={NO_MATCH[filter]}
        {...tableProps}
        toolbar={
          <div>
            <Label htmlFor="my-items-filter">Show</Label>
            <Select
              onValueChange={(next) =>
                void navigate({
                  search: { filter: next as MyItemsFilter },
                })
              }
              value={filter}
            >
              <SelectTrigger className="mt-1 w-40" id="my-items-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MY_ITEMS_FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {FILTER_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        }
      />
      <ListCount count={rows.length} />
      <LineSheet
        actions={
          openRow && canCancel(openRow) && openRow.kind === "request" ? (
            <Button
              disabled={busy}
              onClick={() => {
                const requestItemId = openRow.line.id;
                setOpenId(null);
                void run(async () => {
                  await cancelRequestItem({
                    data: { requestItemId, note: null },
                  });
                });
              }}
              variant="outline"
            >
              Cancel request
            </Button>
          ) : undefined
        }
        events={openRow ? timelineOf(openRow) : []}
        fields={openRow ? fieldsOf(openRow) : []}
        onOpenChange={(open) => {
          if (!open) {
            setOpenId(null);
          }
        }}
        open={openRow !== null}
        title={openRow ? rowName(openRow) : ""}
      />
    </div>
  );
}

/** The requester's timeline: dates and the closing note, and nobody named. */
function timelineOf(row: Row) {
  if (row.kind !== "request") {
    return [];
  }
  return lineTimeline({
    closedAt: row.line.closedAt,
    closedLabel: LINE_STATUS_LABEL[row.line.status] ?? row.line.status,
    closedNote: row.line.closedReason,
    decidedLabel: "Approved",
    reviewedAt: row.line.reviewedAt,
    submittedAt: row.requestedAt,
  });
}

function fieldsOf(row: Row): LineSheetField[] {
  if (row.kind === "cart") {
    return [];
  }
  const pair = row.kind === "hold" ? row.item : row.line;
  return [
    { label: "Item", value: rowName(row) },
    {
      label: "Status",
      value:
        row.kind === "hold" ? (
          <InventoryStatusBadge status={row.item.status} />
        ) : (
          (LINE_STATUS_LABEL[row.line.status] ?? row.line.status)
        ),
    },
    {
      label: "Pickup by",
      value: pair.pickupBy ? <LocalTime dateOnly value={pair.pickupBy} /> : "-",
    },
    {
      label: "Due",
      value: pair.dueAt ? <LocalTime dateOnly value={pair.dueAt} /> : "-",
    },
    ...(row.kind === "request"
      ? [
          {
            label: "Note from staff",
            value: row.line.closedReason ? (
              <span className="whitespace-pre-wrap">
                {row.line.closedReason}
              </span>
            ) : (
              "-"
            ),
          },
        ]
      : []),
  ];
}
