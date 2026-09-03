import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { z } from "zod";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { AdminRequestActions } from "#/components/admin-request-actions";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";
import { LocalTime } from "#/components/local-time";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
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
import { pageTitle } from "#/lib/page-title";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import { listInventoryRequests } from "#/server/inventory";

const STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "returned",
  "all",
] as const;

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
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
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

function buildColumns(onDone: () => void) {
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
        <div className="min-w-0">
          <p className="truncate">
            {ctx.row.original.requester.name ??
              ctx.row.original.requester.email}
          </p>
          <p className="truncate text-muted-foreground text-xs">
            {ctx.row.original.requester.email}
          </p>
        </div>
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
        <AdminRequestActions
          lineId={ctx.row.original.line.id}
          onDone={onDone}
          status={ctx.row.original.line.status}
        />
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
  const { line, q, status } = search;
  const navigate = useNavigate({ from: "/admin/inventory/requests" });

  const onDone = useCallback(() => {
    void router.invalidate();
  }, [router]);
  const columns = useMemo(() => buildColumns(onDone), [onDone]);

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
        emptyMessage="No requests in this view."
        getRowId={(row) => row.line.id}
        highlightedRowId={line}
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
    </div>
  );
}
