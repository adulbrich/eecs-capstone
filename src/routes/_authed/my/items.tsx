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
import { BorrowListPanel } from "#/components/borrow-list-panel";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { LocalTime } from "#/components/local-time";
import { NeedsAttention } from "#/components/my-items-attention";
import { OverdueBadge } from "#/components/overdue-badge";
import { Button } from "#/components/ui/button";
import { ListCount } from "#/components/ui/pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { deadlineOf } from "#/lib/inventory-deadlines";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import {
  cancelRequestItem,
  listMyItems,
  removeFromCart,
  submitCart,
} from "#/server/inventory";

// `tab` is optional rather than defaulted, so "the user asked for Active" and
// "the URL said nothing" stay distinguishable. With a default they collapse
// into the same value, which is what made Active unreachable below.
//
// `sort` and `dir` belong to whichever table is showing. Switching tabs
// rewrites the search to `{ tab }` alone, so a sort chosen on one tab never
// lands on the other's columns.
const searchSchema = z.object({
  tab: z.enum(["cart", "active", "history"]).optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  sort: z.string().optional(),
});

type Tab = "cart" | "active" | "history";

export const Route = createFileRoute("/_authed/my/items")({
  validateSearch: (s) => searchSchema.parse(s),
  loader: () => listMyItems(),
  component: MyItems,
});

type MyItemsData = Awaited<ReturnType<typeof listMyItems>>;
type ActiveRow = MyItemsData["active"][number];
type HistoryRow = MyItemsData["history"][number];

const LINE_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  returned: "Returned",
};

function activeName(row: ActiveRow): string {
  return row.kind === "hold" ? row.item.name : row.itemName;
}

function activeStatus(row: ActiveRow) {
  return row.kind === "hold" ? row.item.status : row.itemStatus;
}

/**
 * The one date a borrower has to act on: the due date when something is
 * out, else the pickup deadline when something is waiting to be collected.
 */
function DeadlineCell({ row }: { row: ActiveRow }) {
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

function whoCell(row: ActiveRow): string {
  if (row.kind === "hold") {
    return "Assigned to you by staff";
  }
  if (row.collectedBy) {
    return `Collected by ${row.collectedBy.name ?? row.collectedBy.email}`;
  }
  return "Requested by you";
}

function canCancel(row: ActiveRow): boolean {
  return (
    row.kind === "request" &&
    (row.line.status === "pending" || row.line.status === "approved") &&
    row.itemStatus !== "checked_out"
  );
}

/**
 * Item, then state, then the date that matters, then who: the hierarchy the
 * flat rows lacked (#64). Sorted by the deadline by default, soonest first,
 * which is the order the server already returns.
 */
function activeColumns(
  busy: boolean,
  onCancel: (requestItemId: string) => void
) {
  return defineAdminColumns<ActiveRow>()([
    {
      accessorFn: (row) => activeName(row),
      cardHeader: true,
      cell: ({ row }) => activeName(row.original),
      enableHiding: false,
      header: "Item",
      id: "item",
    },
    {
      accessorFn: (row) => activeStatus(row),
      cell: ({ row }) => (
        <span className="flex flex-wrap items-center gap-1">
          <InventoryStatusBadge status={activeStatus(row.original)} />
          <OverdueBadge entry={row.original} />
        </span>
      ),
      enableHiding: false,
      header: "State",
      id: "state",
    },
    {
      accessorFn: (row) => deadlineOf(row) ?? undefined,
      cell: ({ row }) => <DeadlineCell row={row.original} />,
      header: "Deadline",
      id: "deadline",
      sortUndefined: "last",
      sortingFn: "datetime",
    },
    {
      accessorFn: (row) => whoCell(row),
      cell: ({ row }) => whoCell(row.original),
      header: "Who",
      id: "who",
    },
    {
      cell: ({ row }) => {
        const entry = row.original;
        if (entry.kind !== "request" || !canCancel(entry)) {
          return null;
        }
        const requestItemId = entry.line.id;
        return (
          <Button
            disabled={busy}
            onClick={() => onCancel(requestItemId)}
            size="sm"
            variant="outline"
          >
            Cancel
          </Button>
        );
      },
      enableHiding: false,
      enableSorting: false,
      header: "Actions",
      id: "actions",
    },
  ]);
}

const ACTIVE_DEFAULT_SORT: SortState = { desc: false, id: "deadline" };

const HISTORY_COLUMNS = defineAdminColumns<HistoryRow>()([
  {
    accessorFn: (row) => row.itemName,
    cardHeader: true,
    cell: ({ row }) => row.original.itemName,
    enableHiding: false,
    header: "Item",
    id: "item",
  },
  {
    accessorFn: (row) => row.line.status,
    cell: ({ row }) =>
      LINE_STATUS_LABEL[row.original.line.status] ?? row.original.line.status,
    header: "Outcome",
    id: "outcome",
  },
  {
    accessorFn: (row) => row.line.createdAt,
    cell: ({ row }) => (
      <LocalTime dateOnly value={row.original.line.createdAt} />
    ),
    header: "Requested",
    id: "requestedAt",
    sortingFn: "datetime",
  },
  {
    accessorFn: (row) =>
      row.collectedBy?.name ?? row.collectedBy?.email ?? undefined,
    cell: ({ row }) =>
      row.original.collectedBy
        ? (row.original.collectedBy.name ?? row.original.collectedBy.email)
        : "-",
    defaultHidden: true,
    header: "Collected by",
    id: "collectedBy",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.line.closedReason ?? undefined,
    cell: ({ row }) => row.original.line.closedReason ?? "-",
    header: "Note from staff",
    id: "note",
    sortUndefined: "last",
  },
]);

const HISTORY_DEFAULT_SORT: SortState = { desc: true, id: "requestedAt" };

function MyItems() {
  const data = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/my/items" });
  const router = useRouter();
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);

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

  // A bare /my/items opens on the borrow list when there is something in it,
  // which is the common case right after adding items. An explicit `?tab=`
  // always wins, so Active stays reachable: the previous derivation re-applied
  // the pin on every render, so selecting Active snapped straight back and the
  // user menu's own "Active" link could never land.
  const tab: Tab = search.tab ?? (data.cart.length > 0 ? "cart" : "active");

  const columns = useMemo(
    () =>
      activeColumns(busy, (requestItemId) =>
        run(async () => {
          await cancelRequestItem({ data: { requestItemId, note: null } });
        })
      ),
    [busy, run]
  );
  const active = useAdminTable({
    columns,
    defaultSort: ACTIVE_DEFAULT_SORT,
    navigate,
    search,
    storageKey: "my-items-active",
  });
  const history = useAdminTable({
    columns: HISTORY_COLUMNS,
    defaultSort: HISTORY_DEFAULT_SORT,
    navigate,
    search,
    storageKey: "my-items-history",
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">My Items</h1>
      <NeedsAttention entries={data.active} />
      {/* Manual activation: selecting a tab pushes a navigation and rewrites
          the URL, so arrowing must only move focus. Under automatic mode,
          arrowing across the strip fires onValueChange (and a navigation) on
          every keypress. */}
      <Tabs
        activationMode="manual"
        className="mt-4"
        onValueChange={(next) =>
          navigate({ search: () => ({ tab: next as Tab }) })
        }
        value={tab}
      >
        <TabsList>
          <TabsTrigger value="cart">
            Borrow list ({data.cart.length})
          </TabsTrigger>
          <TabsTrigger value="active">
            Active ({data.active.length})
          </TabsTrigger>
          <TabsTrigger value="history">
            History ({data.history.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cart">
          <BorrowListPanel
            busy={busy}
            onRemove={(itemId) =>
              run(async () => {
                await removeFromCart({ data: { itemId } });
              })
            }
            onSubmit={(note) =>
              run(async () => {
                const result = await submitCart({
                  data: { note: note || null },
                });
                if (result.skipped.length > 0) {
                  toast.warning(
                    `Submitted ${result.submitted.length}, skipped ${result.skipped.length} (no longer available).`
                  );
                }
                navigate({ search: () => ({ tab: "active" }) });
              })
            }
            rows={data.cart}
          />
        </TabsContent>

        {/* The table renders its own EmptyState from `emptyMessage`, and
            ListCount renders nothing at zero, so neither panel branches. */}
        <TabsContent value="active">
          <AdminDataTable
            caption="Active items"
            data={data.active}
            emptyMessage="Nothing is requested, reserved or checked out to you right now. Submit a borrow list and it shows up here."
            getRowId={(row) =>
              row.kind === "hold" ? `hold:${row.item.id}` : row.line.id
            }
            {...active.tableProps}
          />
          <ListCount count={data.active.length} />
        </TabsContent>

        <TabsContent value="history">
          <AdminDataTable
            caption="History"
            data={data.history}
            emptyMessage="Closed requests, returned, rejected or cancelled, land here."
            getRowId={(row) => row.line.id}
            {...history.tableProps}
          />
          <ListCount count={data.history.length} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
