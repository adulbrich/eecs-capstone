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
} from "#/components/admin-data-table";
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
import { defineCsvColumns, toCsv } from "#/lib/csv";
import { pageTitle } from "#/lib/page-title";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { createProgram, listPrograms } from "#/server/programs";

const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  sort: z.string().optional(),
});

export const Route = createFileRoute("/_authed/admin/programs/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Programs") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loader: async () => listPrograms(),
  component: ProgramsAdmin,
});

type Row = Awaited<ReturnType<typeof listPrograms>>["rows"][number];

const DEFAULT_SORT: SortState = { desc: false, id: "courseId" };

const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.courseId,
    cell: ({ row }) => row.original.courseId,
    enableHiding: false,
    header: "Course ID",
    id: "courseId",
  },
  {
    accessorFn: (row) => row.courseName,
    cell: ({ row }) => row.original.courseName,
    header: "Course name",
    id: "courseName",
  },
  {
    accessorFn: (row) => row.description ?? undefined,
    cell: ({ row }) => row.original.description ?? "-",
    defaultHidden: true,
    header: "Description",
    id: "description",
    sortUndefined: "last",
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
    accessorFn: (row) => row.updatedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.updatedAt} />,
    defaultHidden: true,
    header: "Updated",
    id: "updatedAt",
    sortingFn: "datetime",
  },
  {
    cell: ({ row }) => (
      <Link
        className="hover:underline"
        params={{ programId: row.original.id }}
        to="/admin/programs/$programId"
      >
        Manage
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
// column here, so a future field added to listProgramsImpl's projection
// cannot silently miss the file.
const EXPORT_COLUMNS = defineCsvColumns<Row>()([
  { header: "ID", key: "id", value: (row) => row.id },
  { header: "Course ID", key: "courseId", value: (row) => row.courseId },
  {
    header: "Course name",
    key: "courseName",
    value: (row) => row.courseName,
  },
  {
    header: "Description",
    key: "description",
    value: (row) => row.description,
  },
  { header: "Created", key: "createdAt", value: (row) => row.createdAt },
  { header: "Updated", key: "updatedAt", value: (row) => row.updatedAt },
]);

function ProgramsAdmin() {
  const router = useRouter();
  const { rows } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/admin/programs/" });
  const [open, setOpen] = useState(false);
  const [courseId, setCourseId] = useState("");
  const [courseName, setCourseName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await createProgram({
        data: { courseId, courseName, description: description || null },
      });
      setCourseId("");
      setCourseName("");
      setDescription("");
      setOpen(false);
      router.invalidate();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const { orderRows, tableProps } = useAdminTable({
    columns: COLUMNS,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "programs",
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
            <BreadcrumbPage>Programs</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-semibold text-2xl">Programs</h1>
        <Dialog onOpenChange={setOpen} open={open}>
          <DialogTrigger asChild>
            <Button size="sm">+ New program</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New program</DialogTitle>
              <DialogDescription>
                Add a course program that projects can be associated with.
              </DialogDescription>
            </DialogHeader>
            <form className="flex flex-col gap-4" onSubmit={onCreate}>
              <div className="flex flex-col gap-2">
                <Label htmlFor="prog-course-id">Course ID</Label>
                <Input
                  id="prog-course-id"
                  onChange={(e) => setCourseId(e.target.value)}
                  placeholder="e.g., CS 461"
                  required
                  value={courseId}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="prog-course-name">Course name</Label>
                <Input
                  id="prog-course-name"
                  onChange={(e) => setCourseName(e.target.value)}
                  required
                  value={courseName}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="prog-description">Description</Label>
                <Input
                  id="prog-description"
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional"
                  value={description}
                />
              </div>
              {error && <p className="text-destructive text-sm">{error}</p>}
              <DialogFooter>
                <Button disabled={!(courseId && courseName)} type="submit">
                  Create program
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <AdminDataTable
        actions={
          <ExportCsvButton
            filename="programs"
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
        caption="Programs"
        data={rows}
        emptyMessage="No programs yet."
        getRowId={(row) => row.id}
        {...tableProps}
      />
    </div>
  );
}
