import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useRef, useState } from "react";
import { z } from "zod";
import {
  type AdminColumn,
  AdminDataTable,
} from "#/components/admin-data-table";
import { CategoryTypeCombobox } from "#/components/category-type-combobox";
import { ExportCsvButton } from "#/components/export-csv-button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "#/components/ui/dialog";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { getSession } from "#/lib/auth-guards";
import { defineCsvColumns, orderBySortedIds, toCsv } from "#/lib/csv";
import { pageTitle } from "#/lib/page-title";
import {
  type AdminTableSearch,
  type SortState,
  useAdminTableState,
} from "#/lib/table-state";
import {
  createCategory,
  listCategoriesWithUsage,
  listCategoryTypes,
  type listSchema,
} from "#/server/categories";

const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  sort: z.string().optional(),
  tab: z.enum(["project", "inventory"]).default("project"),
});

export const Route = createFileRoute("/_authed/admin/categories/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Categories") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loaderDeps: ({ search }) => ({ tab: search.tab }),
  loader: async ({ deps }) => {
    const listData = {
      domain: deps.tab,
    } satisfies z.input<typeof listSchema>;
    const [{ rows }, { types }] = await Promise.all([
      listCategoriesWithUsage({ data: listData }),
      listCategoryTypes(),
    ]);
    return { rows, types };
  },
  component: CategoriesAdmin,
});

type Row = Awaited<ReturnType<typeof listCategoriesWithUsage>>["rows"][number];

const PROJECT_DEFAULT_SORT: SortState = { desc: false, id: "type" };
const INVENTORY_DEFAULT_SORT: SortState = { desc: false, id: "name" };

const NAME_COLUMN: AdminColumn<Row> = {
  accessorFn: (row) => row.name,
  cell: ({ row }) => row.original.name,
  enableHiding: false,
  header: "Name",
  id: "name",
};

// One column definition per tab rather than one shared "Usage": the header
// has to name what was counted, and the domain decides which junction table
// the count came from.
const PROJECT_USAGE_COLUMN: AdminColumn<Row> = {
  accessorFn: (row) => row.usageCount,
  cell: ({ row }) => row.original.usageCount,
  header: "Projects",
  id: "usageCount",
  // Numeric, not the locale-compare default, which would compare String(n)
  // and sort 10 before 2.
  sortingFn: "basic",
};

const INVENTORY_USAGE_COLUMN: AdminColumn<Row> = {
  ...PROJECT_USAGE_COLUMN,
  header: "Items",
};

const TYPE_COLUMN: AdminColumn<Row> = {
  accessorFn: (row) => row.type,
  cell: ({ row }) => (
    <span className="text-muted-foreground">{row.original.type}</span>
  ),
  header: "Type",
  id: "type",
};

const CREATED_COLUMN: AdminColumn<Row> = {
  accessorFn: (row) => row.createdAt,
  cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
  defaultHidden: true,
  header: "Created",
  id: "createdAt",
  sortingFn: "datetime",
};

const ACTIONS_COLUMN: AdminColumn<Row> = {
  cell: ({ row }) => (
    <Link
      className="hover:underline"
      params={{ categoryId: row.original.id }}
      to="/admin/categories/$categoryId"
    >
      Edit
    </Link>
  ),
  enableHiding: false,
  enableSorting: false,
  header: "Actions",
  id: "actions",
};

// The project domain keeps the Type column (its facet); the inventory
// domain is flat, so its table never renders a Type column at all.
const PROJECT_COLUMNS: AdminColumn<Row>[] = [
  NAME_COLUMN,
  PROJECT_USAGE_COLUMN,
  TYPE_COLUMN,
  CREATED_COLUMN,
  ACTIONS_COLUMN,
];

const INVENTORY_COLUMNS: AdminColumn<Row>[] = [
  NAME_COLUMN,
  INVENTORY_USAGE_COLUMN,
  CREATED_COLUMN,
  ACTIONS_COLUMN,
];

// Every field of the record, independent of which columns are visible.
// defineCsvColumns<Row>() fails npm run typecheck if a field of Row has no
// column here, so a future field added to listCategoriesImpl's projection
// cannot silently miss the file. One set covers both tabs: type is always
// null for inventory rows, and domain says so explicitly either way.
const EXPORT_COLUMNS = defineCsvColumns<Row>()([
  { header: "ID", key: "id", value: (row) => row.id },
  { header: "Name", key: "name", value: (row) => row.name },
  { header: "Type", key: "type", value: (row) => row.type },
  { header: "Domain", key: "domain", value: (row) => row.domain },
  { header: "Usage", key: "usageCount", value: (row) => row.usageCount },
  { header: "Created", key: "createdAt", value: (row) => row.createdAt },
]);

const TABS = [
  { label: "Project categories", value: "project" },
  { label: "Inventory categories", value: "inventory" },
] as const;

function CategoriesAdmin() {
  const router = useRouter();
  const { rows, types } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/categories/" });
  const { tab } = search;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Populated by AdminDataTable's onSortedIdsChange every time the table's
  // own sorted row order changes. A ref, not state: the export only reads it
  // at click time, so there is no reason to re-render this component (or
  // re-run the effect that populates it) on every sort change.
  const sortedIdsRef = useRef<string[]>([]);
  const onSortedIdsChange = useCallback((ids: string[]) => {
    sortedIdsRef.current = ids;
  }, []);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      if (tab === "project") {
        await createCategory({ data: { domain: "project", name, type } });
      } else {
        await createCategory({
          data: { domain: "inventory", name, type: null },
        });
      }
      setName("");
      setType("");
      setOpen(false);
      router.invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  }

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

  const columns = tab === "project" ? PROJECT_COLUMNS : INVENTORY_COLUMNS;
  const defaultSort =
    tab === "project" ? PROJECT_DEFAULT_SORT : INVENTORY_DEFAULT_SORT;
  const storageKey =
    tab === "project" ? "categories-project" : "categories-inventory";

  const { hidden, onHiddenChange, onSortChange, sort } = useAdminTableState({
    columns,
    defaultSort,
    replaceSearch,
    search,
    setSearch,
    storageKey,
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
            <BreadcrumbPage>Categories</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-semibold text-2xl">Categories</h1>
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogTrigger asChild>
            <Button size="sm">+ New category</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {tab === "project"
                  ? "New project category"
                  : "New inventory category"}
              </DialogTitle>
              <DialogDescription>
                {tab === "project"
                  ? "Add a category and assign it a type. Pick an existing type or create a new one."
                  : "Add a category for inventory items."}
              </DialogDescription>
            </DialogHeader>
            <form className="flex flex-col gap-4" onSubmit={onCreate}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="cat-name">Name</Label>
                <Input
                  id="cat-name"
                  onChange={(e) => setName(e.target.value)}
                  required
                  value={name}
                />
              </div>
              {tab === "project" && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="cat-type">Type</Label>
                  <CategoryTypeCombobox
                    id="cat-type"
                    onChange={setType}
                    types={types}
                    value={type}
                  />
                </div>
              )}
              {error && <p className="text-destructive text-sm">{error}</p>}
              <DialogFooter>
                <Button
                  disabled={tab === "project" ? !(name && type) : !name}
                  type="submit"
                >
                  Create category
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Tabs
        className="mt-4"
        onValueChange={(next) =>
          navigate({ search: { tab: next as "inventory" | "project" } })
        }
        value={tab}
      >
        <TabsList>
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value}>
              {t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={tab}>
          <AdminDataTable
            actions={
              <ExportCsvButton
                filename={
                  tab === "project"
                    ? "project-categories"
                    : "inventory-categories"
                }
                load={() =>
                  Promise.resolve(
                    toCsv(
                      EXPORT_COLUMNS,
                      orderBySortedIds(
                        rows,
                        sortedIdsRef.current,
                        (row) => row.id
                      )
                    )
                  )
                }
              />
            }
            caption={
              tab === "project" ? "Project categories" : "Inventory categories"
            }
            columns={columns}
            data={rows}
            defaultSort={defaultSort}
            emptyMessage={
              tab === "project"
                ? "No project categories yet."
                : "No inventory categories yet."
            }
            getRowId={(row) => row.id}
            hidden={hidden}
            onHiddenChange={onHiddenChange}
            onSortChange={onSortChange}
            onSortedIdsChange={onSortedIdsChange}
            sort={sort}
            storageKey={storageKey}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
