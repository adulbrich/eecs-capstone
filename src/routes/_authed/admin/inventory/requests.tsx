import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { z } from "zod";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { AdminRequestActions } from "#/components/admin-request-actions";
import { ApproveAllDialog } from "#/components/approve-all-dialog";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { LineSheet, type LineSheetField } from "#/components/line-sheet";
import { LocalTime } from "#/components/local-time";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { ListCount } from "#/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { getSession } from "#/lib/auth-guards";
import { lineTimeline } from "#/lib/inventory-timeline";
import { pageTitle } from "#/lib/page-title";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import { cn } from "#/lib/utils";
import { isStaff } from "#/lib/viewer";
import { INVENTORY_REQUEST_ITEM_STATUSES } from "#/lib/vocabularies";
import { listInventoryRequests } from "#/server/inventory";

/** The vocabulary plus the sentinel this filter adds for "no filter". */
const STATUSES = [...INVENTORY_REQUEST_ITEM_STATUSES, "all"] as const;

const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  /**
   * A request line to bring into view, linked from the Request column on
   * `/admin/inventory`. Not in `loaderDeps`: it changes which line is
   * highlighted, never which rows are fetched, so it must not refetch.
   *
   * `.catch(null)` so a stale link to a line that no longer exists degrades to
   * the plain queue rather than a 500.
   */
  line: z.string().uuid().nullable().catch(null).default(null),
  q: z.string().default(""),
  /**
   * A request to bring into view, linked from the Requester column once the
   * reader has sorted the queue flat. Same shape and same reasoning as
   * `line`, and the two compose: a link naming both highlights a line inside
   * a highlighted group.
   */
  request: z.string().uuid().nullable().catch(null).default(null),
  sort: z.string().optional(),
  status: z.enum(STATUSES).default("pending"),
});

export const Route = createFileRoute("/_authed/admin/inventory/requests")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Inventory Requests") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!isStaff(session.user)) {
      throw redirect({ to: "/" });
    }
  },
  // Only the filter fields: sort and column visibility are client state and
  // must not re-run the loader.
  loaderDeps: ({ search }) => ({ q: search.q, status: search.status }),
  loader: async ({ deps }) => await listInventoryRequests({ data: deps }),
  component: AdminRequestQueue,
});

type Row = Awaited<ReturnType<typeof listInventoryRequests>>[number];

const DEFAULT_SORT: SortState = { desc: true, id: "requestedAt" };

function statusLabel(status: string) {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function personName(person: { email: string; name: string | null } | null) {
  return person ? (person.name ?? person.email) : null;
}

/**
 * The strip above one request's lines: who asked, when, the note for staff
 * and how many lines. Everything here rides on every row of the group, which
 * is the constraint the grouping mode puts on its callers.
 *
 * `highlighted` is the `?request=` deep link. Scrolled into view on arrival,
 * the way `AdminDataTable` scrolls a highlighted row.
 */
function RequestGroupHeader({
  highlighted,
  rows,
}: {
  highlighted: boolean;
  rows: Row[];
}) {
  const first = rows[0];
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (highlighted) {
      ref.current?.scrollIntoView({ block: "center" });
    }
  }, [highlighted]);
  const count = rows.length;
  return (
    <div
      className={cn(
        "space-y-0.5",
        highlighted && "rounded-md bg-[var(--brand-primary-tint)] px-2 py-1"
      )}
      data-highlighted-group={highlighted ? "" : undefined}
      ref={ref}
    >
      <p>
        {personName(first.requester)}
        <span className="font-normal text-muted-foreground">
          {" "}
          requested {count} {count === 1 ? "line" : "lines"} on{" "}
          <LocalTime value={first.requestedAt} />
        </span>
      </p>
      {first.note && (
        <p className="whitespace-pre-wrap font-normal text-muted-foreground text-xs">
          {first.note}
        </p>
      )}
    </div>
  );
}

function buildColumns(onDone: () => void, onOpen: (lineId: string) => void) {
  return defineAdminColumns<Row>()([
    {
      accessorFn: (row) => row.item.name,
      cardHeader: true,
      cell: (ctx) => (
        <div className="flex items-center gap-2">
          <span className="font-medium">{ctx.row.original.item.name}</span>
          <InventoryStatusBadge
            status={ctx.row.original.item.status as "available"}
          />
        </div>
      ),
      enableHiding: false,
      header: "Item",
      id: "item",
    },
    {
      accessorFn: (row) => row.requester.name ?? row.requester.email,
      cell: (ctx) => (
        // Sorting by any column flattens the queue, and this is then the
        // only thing naming the request a line arrived in. The link clears
        // the sort so it lands back in the grouped view, with this request
        // highlighted, rather than in the flat view it was clicked from.
        <Link
          className="block min-w-0 hover:underline"
          from="/admin/inventory/requests"
          search={(prev) => ({
            ...prev,
            dir: undefined,
            request: ctx.row.original.requestId,
            sort: undefined,
          })}
          to="/admin/inventory/requests"
        >
          <p className="truncate">
            {ctx.row.original.requester.name ??
              ctx.row.original.requester.email}
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {ctx.row.original.requester.email}
          </p>
        </Link>
      ),
      header: "Requester",
      id: "requester",
    },
    {
      accessorFn: (row) => row.line.status,
      cell: (ctx) => statusLabel(ctx.row.original.line.status),
      header: "Status",
      id: "status",
    },
    {
      accessorFn: (row) => row.requestedAt,
      cell: (ctx) => <LocalTime value={ctx.row.original.requestedAt} />,
      header: "Requested",
      id: "requestedAt",
      // Dates, so not the default comparator: it compares String() forms,
      // which start with the weekday name and sort Friday before Monday.
      sortingFn: "datetime",
    },
    {
      accessorFn: (row) => row.note ?? "",
      cell: (ctx) => (
        <span className="whitespace-pre-wrap">{ctx.row.original.note}</span>
      ),
      // Batch-level context. Every line of a batch repeats it, so it is off by
      // default and there when a row needs explaining.
      defaultHidden: true,
      header: "Note",
      id: "note",
    },
    {
      accessorFn: (row) =>
        row.collectedBy?.name ?? row.collectedBy?.email ?? "",
      header: "Collected by",
      defaultHidden: true,
      id: "collectedBy",
    },
    {
      cell: (ctx) => (
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => onOpen(ctx.row.original.line.id)}
            size="sm"
            variant="outline"
          >
            Details
          </Button>
          <AdminRequestActions
            lineId={ctx.row.original.line.id}
            onDone={onDone}
            status={ctx.row.original.line.status}
          />
        </div>
      ),
      enableSorting: false,
      header: "Actions",
      id: "actions",
    },
  ]);
}

function AdminRequestQueue() {
  const rows = Route.useLoaderData();
  const router = useRouter();
  const search = Route.useSearch();
  const { line, q, request, status } = search;
  // The default view is already narrowed to pending, so it counts as a filter:
  // a staff member with no pending requests still wants the status select
  // and the headers, not a bare message.
  const filtered = q !== "" || status !== "all";
  const navigate = useNavigate({ from: "/admin/inventory/requests" });

  const onDone = useCallback(() => {
    void router.invalidate();
  }, [router]);
  // The sheet is a sibling of the table, keyed by the open line's id rather
  // than holding a row, so a refetch after a decision shows the fresh row.
  const [openLineId, setOpenLineId] = useState<string | null>(null);
  const columns = useMemo(() => buildColumns(onDone, setOpenLineId), [onDone]);
  const openRow = openLineId
    ? (rows.find((row) => row.line.id === openLineId) ?? null)
    : null;

  const commitQuery = useCallback(
    (next: string) => {
      void navigate({ search: (prev) => ({ ...prev, q: next }) });
    },
    [navigate]
  );
  const [qDraft, setQDraft] = useDebouncedDraft(q, commitQuery);

  const { tableProps } = useAdminTable({
    columns,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "inventory-requests",
  });

  return (
    <div className="px-4 py-6 md:px-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin">Admin</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin/inventory">Inventory</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Requests</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Inventory requests</h1>

      <AdminDataTable
        caption="Inventory requests"
        data={rows}
        emptyMessage="No requests yet."
        filtered={filtered}
        getRowId={(row) => row.line.id}
        group={{
          actions: (groupRows) => (
            <ApproveAllDialog
              lines={groupRows.map((row) => ({
                id: row.line.id,
                itemName: row.item.name,
                status: row.line.status,
              }))}
              onDone={onDone}
            />
          ),
          header: (groupRows) => (
            <RequestGroupHeader
              highlighted={groupRows[0].requestId === request}
              rows={groupRows}
            />
          ),
          key: (row) => row.requestId,
        }}
        highlightedRowId={line}
        noMatchMessage="No requests in this view."
        {...tableProps}
        toolbar={
          <>
            <div>
              <Label htmlFor="request-search">Search</Label>
              <Input
                className="mt-1 w-64"
                id="request-search"
                onChange={(e) => setQDraft(e.target.value)}
                placeholder="Item, requester name, or email"
                type="search"
                value={qDraft}
              />
            </div>
            <div>
              <Label htmlFor="request-filter-status">Status</Label>
              <Select
                onValueChange={(s) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      status: s as (typeof STATUSES)[number],
                    }),
                  })
                }
                value={status}
              >
                <SelectTrigger className="mt-1 w-48" id="request-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "All statuses" : statusLabel(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        }
      />
      <ListCount count={rows.length} />
      <LineSheet
        actions={
          openRow && openRow.line.status === "pending" ? (
            <AdminRequestActions
              lineId={openRow.line.id}
              onDone={() => {
                setOpenLineId(null);
                onDone();
              }}
              status={openRow.line.status}
            />
          ) : undefined
        }
        description={
          openRow
            ? `Requested by ${personName(openRow.requester) ?? ""}`
            : undefined
        }
        events={openRow ? timelineOf(openRow) : []}
        fields={openRow ? fieldsOf(openRow) : []}
        onOpenChange={(open) => {
          if (!open) {
            setOpenLineId(null);
          }
        }}
        open={openRow !== null}
        title={openRow?.item.name ?? ""}
      />
    </div>
  );
}

/** The staff timeline: dates, actors, and the closing reason. */
function timelineOf(row: Row) {
  return lineTimeline({
    closedAt: row.line.closedAt,
    closedBy: personName(row.closer),
    closedLabel: statusLabel(row.line.status),
    closedNote: row.line.closedReason,
    decidedLabel: "Approved",
    reviewedAt: row.line.reviewedAt,
    reviewedBy: personName(row.reviewer),
    submittedAt: row.requestedAt,
  });
}

function fieldsOf(row: Row): LineSheetField[] {
  return [
    {
      label: "Item",
      value: (
        <span className="flex flex-wrap items-center gap-2">
          {row.item.name}
          <InventoryStatusBadge status={row.item.status as "available"} />
        </span>
      ),
    },
    {
      label: "Requester",
      value: `${row.requester.name ?? row.requester.email} (${row.requester.email})`,
    },
    { label: "Status", value: statusLabel(row.line.status) },
    {
      label: "Pickup by",
      value: row.line.pickupBy ? (
        <LocalTime dateOnly value={row.line.pickupBy} />
      ) : (
        "-"
      ),
    },
    {
      label: "Due",
      value: row.line.dueAt ? (
        <LocalTime dateOnly value={row.line.dueAt} />
      ) : (
        "-"
      ),
    },
    {
      label: "Collected by",
      value: row.collectedBy?.name ?? row.collectedBy?.email ?? "-",
    },
    {
      label: "Note",
      value: row.note ? (
        <span className="whitespace-pre-wrap">{row.note}</span>
      ) : (
        "-"
      ),
    },
  ];
}
