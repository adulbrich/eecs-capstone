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
  listCategories,
  listCategoryTypes,
} from "#/server/categories";

const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  sort: z.string().optional(),
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
  loader: async () => {
    const [{ rows }, { types }] = await Promise.all([
      listCategories({ data: {} }),
      listCategoryTypes(),
    ]);
    return { rows, types };
  },
  component: CategoriesAdmin,
});

type Row = Awaited<ReturnType<typeof listCategories>>["rows"][number];

const DEFAULT_SORT: SortState = { desc: false, id: "type" };

const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.name,
    cell: ({ row }) => row.original.name,
    enableHiding: false,
    header: "Name",
    id: "name",
  },
  {
    accessorFn: (row) => row.type,
    cell: ({ row }) => (
      <span className="text-muted-foreground">{row.original.type}</span>
    ),
    header: "Type",
    id: "type",
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
  },
];

// Every field of the record, independent of which columns are visible.
// defineCsvColumns<Row>() fails npm run typecheck if a field of Row has no
// column here, so a future field added to listCategoriesImpl's projection
// cannot silently miss the file.
const EXPORT_COLUMNS = defineCsvColumns<Row>()([
  { header: "ID", key: "id", value: (row) => row.id },
  { header: "Name", key: "name", value: (row) => row.name },
  { header: "Type", key: "type", value: (row) => row.type },
  { header: "Created", key: "createdAt", value: (row) => row.createdAt },
]);

function CategoriesAdmin() {
  const router = useRouter();
  const { rows, types } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/categories/" });
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
      await createCategory({ data: { name, type } });
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

  const { hidden, onHiddenChange, onSortChange, sort } = useAdminTableState({
    columns: COLUMNS,
    defaultSort: DEFAULT_SORT,
    replaceSearch,
    search,
    setSearch,
    storageKey: "categories",
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
              <DialogTitle>New category</DialogTitle>
              <DialogDescription>
                Add a category and assign it a type. Pick an existing type or
                create a new one.
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
              <div className="flex flex-col gap-2">
                <Label htmlFor="cat-type">Type</Label>
                <CategoryTypeCombobox
                  id="cat-type"
                  onChange={setType}
                  types={types}
                  value={type}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <DialogFooter>
                <Button disabled={!(name && type)} type="submit">
                  Create category
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <AdminDataTable
        actions={
          <ExportCsvButton
            filename="categories"
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
        caption="Categories"
        columns={COLUMNS}
        data={rows}
        defaultSort={DEFAULT_SORT}
        emptyMessage="No categories yet."
        getRowId={(row) => row.id}
        hidden={hidden}
        onHiddenChange={onHiddenChange}
        onSortChange={onSortChange}
        onSortedIdsChange={onSortedIdsChange}
        sort={sort}
        storageKey="categories"
      />
    </div>
  );
}
