import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  type AdminColumn,
  AdminDataTable,
} from "#/components/admin-data-table";
import { CategoryChip } from "#/components/category-chip";
import { CategoryFilterCombobox } from "#/components/category-filter-combobox";
import { ExportCsvButton } from "#/components/export-csv-button";
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
import { Button } from "#/components/ui/button";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { getSession } from "#/lib/auth-guards";
import { defineCsvColumns, orderBySortedIds, toCsv } from "#/lib/csv";
import { formatHoldShort, holdFromStoredRow } from "#/lib/hold";
import { pageTitle } from "#/lib/page-title";
import { getPublicUrl } from "#/lib/storage";
import {
  type AdminTableSearch,
  type SortState,
  useAdminTableState,
} from "#/lib/table-state";
import {
  listAdminInventory,
  listInventoryCategories,
} from "#/server/inventory";

const STATUSES = [
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
] as const;

type Status = (typeof STATUSES)[number];

const searchSchema = z.object({
  // A stale pre-UUID `?category=` link (singular) fails
  // `.array().uuid()`; caught and treated as "no filter" instead of a
  // router error. Matches the public listing.
  categories: z.array(z.string().uuid()).max(20).catch([]).default([]),
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  q: z.string().default(""),
  sort: z.string().optional(),
  status: z.enum(STATUSES).nullable().default(null),
});

export const Route = createFileRoute("/_authed/admin/inventory/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Inventory") }] }),
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
  loaderDeps: ({ search }) => ({
    categories: search.categories,
    q: search.q,
    status: search.status,
  }),
  loader: async ({ deps }) => {
    const [items, categories] = await Promise.all([
      listAdminInventory({ data: deps }),
      listInventoryCategories(),
    ]);
    return { categories: categories.categories, rows: items.rows };
  },
  component: AdminInventory,
});

type Row = Awaited<ReturnType<typeof listAdminInventory>>["rows"][number];

const STATUS_ORDER: Record<string, number> = {
  available: 0,
  requested: 1,
  reserved: 2,
  checked_out: 3,
  maintenance: 4,
};

const DEFAULT_SORT: SortState = { desc: true, id: "updatedAt" };

/**
 * Who the item is associated with, in one line. The row's columns arrive
 * already reconciled against the joined account, so this only has to read the
 * hold off them and let the Hold module apply the precedence.
 *
 * Which column shows it is a separate question, below: the same five columns
 * describe both possession and a claim, and only the item's status tells the
 * two apart.
 */
function holdOf(row: Row): string | null {
  return formatHoldShort(
    holdFromStoredRow({
      currentHolderId: row.currentHolderId,
      currentHolderEmail: row.currentHolderEmail,
      currentHolderLabel: row.currentHolderLabel,
      currentHolderName: row.currentHolderName,
      currentHolderProgram: row.currentHolderProgram,
    })
  );
}

/**
 * Who physically has the item. Only a checkout puts it in someone's hands, so
 * a reserved item has no holder however firmly it is spoken for.
 */
function heldBy(row: Row): string | null {
  return row.status === "checked_out" ? holdOf(row) : null;
}

/**
 * Who the item is waiting on. Covers both halves of how that happens: a
 * request the student submitted, and a reservation staff assigned directly to
 * an address or a label. The second has no request line at all, which is why
 * this reads the hold rather than the requester.
 *
 * `requested` and `reserved` share the column. The Status column already says
 * which of the two it is, and the name is equally useful either way.
 */
function reservedFor(row: Row): string | null {
  return row.status === "requested" || row.status === "reserved"
    ? holdOf(row)
    : null;
}

const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.name,
    cell: ({ row }) => {
      const img = getPublicUrl(row.original.imageUrl);
      return (
        <div className="flex items-center gap-2">
          {img ? (
            <img alt="" className="h-8 w-8 rounded object-cover" src={img} />
          ) : (
            <div className="h-8 w-8 rounded bg-secondary" />
          )}
          <Link
            className="hover:underline"
            params={{ itemId: row.original.id }}
            to="/inventory/$itemId"
          >
            {row.original.name}
          </Link>
        </div>
      );
    },
    cardHeader: true,
    enableHiding: false,
    header: "Name",
    id: "name",
  },
  {
    // Alphabetical status order means nothing to a reader; this is the order
    // an item actually moves through.
    accessorFn: (row) => STATUS_ORDER[row.status] ?? 99,
    cell: ({ row }) => (
      <InventoryStatusBadge
        showRetired
        status={row.original.status as Status}
      />
    ),
    header: "Status",
    id: "status",
    // Numeric, not text: the locale-compare default would compare String(n),
    // where "10" sorts before "2". Only single-digit ordinals plus a 99
    // sentinel exist today, so this is latent until a tenth status arrives.
    sortingFn: "basic",
  },
  {
    // Email before label: a hold assigned to a bare address has no account to
    // name it, and the address is the only thing that identifies the holder.
    // That order lives in src/lib/hold.ts, so this column renders a hold
    // rather than re-deriving the precedence from raw columns.
    //
    // formatHoldShort returns null for an unheld item and this needs
    // undefined: sortUndefined only special-cases undefined, and a null would
    // sort into the middle of the column instead of the bottom.
    accessorFn: (row) => heldBy(row) ?? undefined,
    cell: ({ row }) => heldBy(row.original) ?? "-",
    header: "Holder",
    // Keeps the id it has always had, so column-visibility state already saved
    // in a URL or in localStorage still refers to this column.
    id: "holder",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => reservedFor(row) ?? undefined,
    cell: ({ row }) => reservedFor(row.original) ?? "-",
    header: "Reserved for",
    id: "reservedFor",
    sortUndefined: "last",
  },
  {
    cell: ({ row }) =>
      row.original.currentRequestItemId ? (
        <Link
          className="underline underline-offset-2"
          search={{ line: row.original.currentRequestItemId, tab: "all" }}
          to="/admin/inventory/requests"
        >
          View request
        </Link>
      ) : (
        "-"
      ),
    // Nothing to order by: the cell is a link, and the id behind it is a uuid
    // that means nothing in sorted order.
    enableSorting: false,
    header: "Request",
    id: "request",
  },
  {
    accessorFn: (row) => row.location ?? undefined,
    cell: ({ row }) => row.original.location ?? "-",
    header: "Location",
    id: "location",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) =>
      row.categories.length > 0
        ? row.categories.map((c) => c.name).join("; ")
        : undefined,
    cell: ({ row }) =>
      row.original.categories.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {row.original.categories.map((category) => (
            <CategoryChip
              category={{ ...category, type: null }}
              key={category.id}
            />
          ))}
        </div>
      ) : (
        "-"
      ),
    header: "Category",
    id: "category",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.label ?? undefined,
    cell: ({ row }) => row.original.label ?? "-",
    defaultHidden: true,
    header: "Label",
    id: "label",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.serial ?? undefined,
    cell: ({ row }) => row.original.serial ?? "-",
    defaultHidden: true,
    header: "Serial",
    id: "serial",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.dueAt ?? undefined,
    cell: ({ row }) =>
      row.original.dueAt ? (
        <LocalTime dateOnly value={row.original.dueAt} />
      ) : (
        "-"
      ),
    defaultHidden: true,
    header: "Due",
    id: "dueAt",
    // Values arrive as Date instances (or ISO strings); the locale-compare
    // default sortingFn would compare their String() forms, which starts
    // with the weekday name and sorts nothing chronologically.
    sortingFn: "datetime",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.updatedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.updatedAt} />,
    // Visible by default: this is the page's default sort column, and a
    // staff table sorted by a date should show that date rather than hide
    // the one column that explains the order rows are in.
    header: "Updated",
    id: "updatedAt",
    sortingFn: "datetime",
  },
  {
    accessorFn: (row) => row.createdAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
    defaultHidden: true,
    header: "Created",
    id: "createdAt",
    sortingFn: "datetime",
  },
  {
    cell: ({ row }) => (
      <Link
        className="hover:underline"
        params={{ itemId: row.original.id }}
        to="/inventory/$itemId/edit"
      >
        Edit
      </Link>
    ),
    enableHiding: false,
    enableSorting: false,
    header: "Actions",
    id: "actions",
  },
];

// Every field of the record, independent of which columns are visible.
// defineCsvColumns<Row>() fails npm run typecheck if a field of Row (i.e. of
// InventoryItemStaff) has no column here, so a future field added to
// fullForStaff's projection cannot silently miss the file. InventoryItemStaff
// is a hand-picked field list, not the bare table row, so searchVector was
// never a member of Row to begin with.
const EXPORT_COLUMNS = defineCsvColumns<Row>()([
  { header: "ID", key: "id", value: (row) => row.id },
  { header: "Name", key: "name", value: (row) => row.name },
  {
    header: "Description",
    key: "description",
    value: (row) => row.description,
  },
  {
    header: "Categories",
    key: "categories",
    value: (row) => row.categories.map((c) => c.name).join("; "),
  },
  { header: "Status", key: "status", value: (row) => row.status },
  { header: "Serial", key: "serial", value: (row) => row.serial },
  { header: "Label", key: "label", value: (row) => row.label },
  { header: "Location", key: "location", value: (row) => row.location },
  { header: "Staff notes", key: "notes", value: (row) => row.notes },
  { header: "Image URL", key: "imageUrl", value: (row) => row.imageUrl },
  {
    header: "Holder name",
    key: "currentHolderName",
    value: (row) => row.currentHolderName,
  },
  {
    header: "Holder email",
    key: "currentHolderEmail",
    value: (row) => row.currentHolderEmail,
  },
  {
    header: "Holder ID",
    key: "currentHolderId",
    value: (row) => row.currentHolderId,
  },
  {
    header: "Holder label",
    key: "currentHolderLabel",
    value: (row) => row.currentHolderLabel,
  },
  {
    header: "Holder program",
    key: "currentHolderProgram",
    value: (row) => row.currentHolderProgram,
  },
  { header: "Pick up by", key: "pickupBy", value: (row) => row.pickupBy },
  { header: "Due", key: "dueAt", value: (row) => row.dueAt },
  {
    header: "Current request item ID",
    key: "currentRequestItemId",
    value: (row) => row.currentRequestItemId,
  },
  { header: "Created", key: "createdAt", value: (row) => row.createdAt },
  { header: "Updated", key: "updatedAt", value: (row) => row.updatedAt },
]);

function AdminInventory() {
  const navigate = useNavigate({ from: "/admin/inventory/" });
  const { categories, rows } = Route.useLoaderData();
  // The whole search object goes to the hook, which reads cols/dir/sort.
  const search = Route.useSearch();
  const { categories: selectedCategories, q, status } = search;
  const [qDraft, setQDraft] = useState(q);
  // Populated by AdminDataTable's onSortedIdsChange every time the table's
  // own sorted row order changes. A ref, not state: the export only reads it
  // at click time, so there is no reason to re-render this component (or
  // re-run the effect that populates it) on every sort change.
  const sortedIdsRef = useRef<string[]>([]);
  const onSortedIdsChange = useCallback((ids: string[]) => {
    sortedIdsRef.current = ids;
  }, []);

  useEffect(() => setQDraft(q), [q]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (qDraft !== q) {
        void navigate({ search: (prev) => ({ ...prev, q: qDraft }) });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [qDraft, q, navigate]);

  const setSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({ search: (prev) => ({ ...prev, ...patch }) }),
    [navigate]
  );
  const replaceSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({
        replace: true,
        search: (prev) => ({ ...prev, ...patch }),
      }),
    [navigate]
  );

  const { hidden, onHiddenChange, onSortChange, sort } = useAdminTableState({
    columns: COLUMNS,
    defaultSort: DEFAULT_SORT,
    replaceSearch,
    search,
    setSearch,
    storageKey: "inventory",
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
            <BreadcrumbPage>Inventory</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-semibold text-2xl">Inventory</h1>
        <div className="flex gap-2">
          <Button asChild size="sm" variant="outline">
            <Link to="/admin/inventory/requests">Request queue</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/inventory/new">+ New item</Link>
          </Button>
        </div>
      </div>

      <AdminDataTable
        actions={
          <ExportCsvButton
            filename="inventory"
            load={() =>
              Promise.resolve(
                toCsv(
                  EXPORT_COLUMNS,
                  orderBySortedIds(rows, sortedIdsRef.current, (row) => row.id)
                )
              )
            }
          />
        }
        caption="Inventory items"
        columns={COLUMNS}
        data={rows}
        defaultSort={DEFAULT_SORT}
        emptyMessage="No items in this view."
        getRowId={(row) => row.id}
        hidden={hidden}
        onHiddenChange={onHiddenChange}
        onSortChange={onSortChange}
        onSortedIdsChange={onSortedIdsChange}
        sort={sort}
        storageKey="inventory"
        toolbar={
          <>
            <div>
              <Label htmlFor="inv-search">Search</Label>
              <Input
                className="mt-1 w-64"
                id="inv-search"
                onChange={(e) => setQDraft(e.target.value)}
                placeholder="Name, description, serial, label, location, or holder"
                type="search"
                value={qDraft}
              />
            </div>
            <div>
              <Label htmlFor="inv-status">Status</Label>
              <Select
                onValueChange={(v) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      status: (v === "_all_" ? null : v) as Status | null,
                    }),
                  })
                }
                value={status ?? "_all_"}
              >
                <SelectTrigger className="mt-1 w-40" id="inv-status">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">All statuses</SelectItem>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="inv-category">
                Categories (matches all selected)
              </Label>
              <div className="mt-1 w-56">
                <CategoryFilterCombobox
                  categories={categories}
                  id="inv-category"
                  onChange={(next) =>
                    void navigate({
                      search: (prev) => ({ ...prev, categories: next }),
                    })
                  }
                  value={selectedCategories}
                />
              </div>
            </div>
          </>
        }
      />
    </div>
  );
}
