import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
  type AdminColumn,
  AdminDataTable,
  defineAdminColumns,
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
import { ListCount } from "#/components/ui/pagination";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "#/components/ui/tabs";
import { getSession } from "#/lib/auth-guards";
import { defineCsvColumns, toCsv } from "#/lib/csv";
import { pageTitle } from "#/lib/page-title";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { isStaff } from "#/lib/viewer";
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
    if (!isStaff(session.user)) {
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

const NAME_COLUMN = {
  accessorFn: (row) => row.name,
  cell: ({ row }) => row.original.name,
  enableHiding: false,
  header: "Name",
  id: "name" as const,
} satisfies AdminColumn<Row>;

// One column definition per tab rather than one shared "Usage": the header
// has to name what was counted, and the domain decides which junction table
// the count came from.
const PROJECT_USAGE_COLUMN = {
  accessorFn: (row) => row.usageCount,
  cell: ({ row }) => row.original.usageCount,
  header: "Projects",
  id: "usageCount" as const,
  // Numeric, not the locale-compare default, which would compare String(n)
  // and sort 10 before 2.
  sortingFn: "basic",
} satisfies AdminColumn<Row>;

const INVENTORY_USAGE_COLUMN = {
  ...PROJECT_USAGE_COLUMN,
  header: "Items",
} satisfies AdminColumn<Row>;

const TYPE_COLUMN = {
  // `?? undefined` rather than the bare field: `Row` covers both tabs, so its
  // `type` is nullable even though this column only ever renders on the
  // project tab, where a typeless category cannot exist. A `null` reaching an
  // accessor sorts as the string "null" among the real values, which is the
  // trap `defineAdminColumns` refuses to compile.
  accessorFn: (row) => row.type ?? undefined,
  cell: ({ row }) => (
    <span className="text-muted-foreground">{row.original.type}</span>
  ),
  header: "Type",
  id: "type" as const,
} satisfies AdminColumn<Row>;

const CREATED_COLUMN = {
  accessorFn: (row) => row.createdAt,
  cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
  defaultHidden: true,
  header: "Created",
  id: "createdAt" as const,
  sortingFn: "datetime",
} satisfies AdminColumn<Row>;

const ACTIONS_COLUMN = {
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
  id: "actions" as const,
} satisfies AdminColumn<Row>;

// The project domain keeps the Type column (its facet); the inventory
// domain is flat, so its table never renders a Type column at all.
const PROJECT_COLUMNS = defineAdminColumns<Row>()([
  NAME_COLUMN,
  PROJECT_USAGE_COLUMN,
  TYPE_COLUMN,
  CREATED_COLUMN,
  ACTIONS_COLUMN,
]);

const INVENTORY_COLUMNS = defineAdminColumns<Row>()([
  NAME_COLUMN,
  INVENTORY_USAGE_COLUMN,
  CREATED_COLUMN,
  ACTIONS_COLUMN,
]);

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

  const columns = tab === "project" ? PROJECT_COLUMNS : INVENTORY_COLUMNS;
  const defaultSort =
    tab === "project" ? PROJECT_DEFAULT_SORT : INVENTORY_DEFAULT_SORT;
  const storageKey =
    tab === "project" ? "categories-project" : "categories-inventory";

  const { orderRows, tableProps } = useAdminTable({
    columns,
    defaultSort,
    navigate,
    search,
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

      {/* Manual activation: selecting a tab pushes a navigation and rewrites
          the URL, so arrowing must only move focus. Under automatic mode,
          arrowing across the strip fires onValueChange (and a navigation) on
          every keypress. */}
      <Tabs
        activationMode="manual"
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
                      orderRows(rows, (row) => row.id)
                    )
                  )
                }
              />
            }
            caption={
              tab === "project" ? "Project categories" : "Inventory categories"
            }
            data={rows}
            emptyMessage={
              tab === "project"
                ? "No project categories yet."
                : "No inventory categories yet."
            }
            getRowId={(row) => row.id}
            {...tableProps}
          />
          <ListCount count={rows.length} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
