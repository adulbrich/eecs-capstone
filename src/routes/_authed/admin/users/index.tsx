import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import {
  type AdminColumn,
  AdminDataTable,
} from "#/components/admin-data-table";
import { ExportCsvButton } from "#/components/export-csv-button";
import { FilterSwitch } from "#/components/filter-switch";
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
import {
  Pagination,
  PaginationLink,
  PaginationStatus,
} from "#/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { getSession } from "#/lib/auth-guards";
import { defineCsvColumns, toCsv } from "#/lib/csv";
import { pageTitle } from "#/lib/page-title";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import { exportUsers, listUsers } from "#/server/users";

const ROLES = ["user", "instructor", "admin"] as const;

const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  includeBanned: z.boolean().default(true),
  page: z.number().int().min(1).default(1),
  q: z.string().default(""),
  role: z.enum(ROLES).nullable().default(null),
  sort: z.string().optional(),
});

export const Route = createFileRoute("/_authed/admin/users/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Users") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (session.user.role !== "admin") {
      throw redirect({ to: "/admin" });
    }
  },
  // Unlike the other admin tables, this one paginates on the server, so a
  // sort change requires a new query: sort and dir have to be loader deps
  // here, not client-only state. cols stays out regardless, because column
  // visibility never involves the server.
  loaderDeps: ({ search }) => ({
    dir: search.dir,
    includeBanned: search.includeBanned,
    page: search.page,
    q: search.q,
    role: search.role,
    sort: search.sort,
  }),
  loader: async ({ deps }) =>
    await listUsers({
      data: {
        dir: deps.dir,
        includeBanned: deps.includeBanned,
        page: deps.page,
        pageSize: 20,
        q: deps.q,
        role: deps.role,
        sort: deps.sort,
      },
    }),
  component: UsersAdmin,
});

type Row = Awaited<ReturnType<typeof listUsers>>["rows"][number];

const DEFAULT_SORT: SortState = { desc: true, id: "createdAt" };

const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.email,
    cell: ({ row }) => row.original.email,
    enableHiding: false,
    header: "Email",
    id: "email",
  },
  {
    accessorFn: (row) => row.name ?? undefined,
    cell: ({ row }) => row.original.name ?? "(none)",
    header: "Name",
    id: "name",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.role,
    cell: ({ row }) => row.original.role,
    header: "Role",
    id: "role",
  },
  {
    accessorFn: (row) => row.banned,
    cell: ({ row }) => (row.original.banned ? "yes" : ""),
    header: "Banned",
    id: "banned",
  },
  {
    accessorFn: (row) => row.createdAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
    // Visible by default: this is the page's default sort column, and a
    // staff table sorted by a date should show that date rather than hide
    // the one column that explains the order rows are in.
    header: "Created",
    id: "createdAt",
    sortingFn: "datetime",
  },
  {
    cell: ({ row }) => (
      <Link params={{ userId: row.original.id }} to="/admin/users/$userId">
        Manage
      </Link>
    ),
    enableHiding: false,
    enableSorting: false,
    header: "Actions",
    id: "actions",
  },
];

type ExportRow = Awaited<ReturnType<typeof exportUsers>>["rows"][number];

// One entry per field the export projection selects (src/server/_internal/
// users.ts, exportUsersImpl): the full user record minus authentication
// material from account/session/verification. defineCsvColumns<ExportRow>()
// fails npm run typecheck if a field of ExportRow has no column here, so a
// future field added to that projection cannot silently miss the file.
const EXPORT_COLUMNS = defineCsvColumns<ExportRow>()([
  { header: "ID", key: "id", value: (row) => row.id },
  { header: "Name", key: "name", value: (row) => row.name },
  { header: "Email", key: "email", value: (row) => row.email },
  {
    header: "Email verified",
    key: "emailVerified",
    value: (row) => row.emailVerified,
  },
  { header: "Image", key: "image", value: (row) => row.image },
  { header: "Role", key: "role", value: (row) => row.role },
  { header: "Banned", key: "banned", value: (row) => row.banned },
  { header: "Ban reason", key: "banReason", value: (row) => row.banReason },
  { header: "Ban expires", key: "banExpires", value: (row) => row.banExpires },
  {
    header: "Affiliation",
    key: "affiliation",
    value: (row) => row.affiliation,
  },
  { header: "LinkedIn", key: "linkedin", value: (row) => row.linkedin },
  {
    header: "Wants to mentor",
    key: "wantsToMentor",
    value: (row) => row.wantsToMentor,
  },
  {
    header: "Mentor team count",
    key: "mentorTeamCount",
    value: (row) => row.mentorTeamCount,
  },
  { header: "Created", key: "createdAt", value: (row) => row.createdAt },
  { header: "Updated", key: "updatedAt", value: (row) => row.updatedAt },
]);

function UsersAdmin() {
  const navigate = useNavigate({ from: "/admin/users/" });
  const { page, pageSize, rows, total } = Route.useLoaderData();
  // The whole search object goes to the hook, which reads cols/dir/sort.
  const search = Route.useSearch();
  const { includeBanned, q, role } = search;
  const commitQuery = useCallback(
    (next: string) => {
      void navigate({
        search: (prev) => ({ ...prev, page: 1, q: next }),
      });
    },
    [navigate]
  );
  const [qDraft, setQDraft] = useDebouncedDraft(q, commitQuery);

  const { tableProps } = useAdminTable({
    columns: COLUMNS,
    data: rows,
    defaultSort: DEFAULT_SORT,
    getRowId: (row) => row.id,
    navigate,
    // The server paginates this table, so a sort change re-queries a newly
    // ordered set and the page the reader was on no longer names the same
    // rows.
    resetPageOnSort: true,
    search,
    // The server also orders it, so local reordering would sort the twenty
    // rows on screen while presenting that as sorting the table.
    serverSorted: true,
    storageKey: "users",
  });

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

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
            <BreadcrumbPage>Users</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Users</h1>

      <AdminDataTable
        actions={
          <ExportCsvButton
            filename="users"
            load={async () => {
              const { rows: exportRows } = await exportUsers({
                data: {
                  dir: search.dir,
                  includeBanned: search.includeBanned,
                  q: search.q,
                  role: search.role,
                  sort: search.sort,
                },
              });
              return toCsv(EXPORT_COLUMNS, exportRows);
            }}
          />
        }
        caption="Users"
        emptyMessage="No users in this view."
        {...tableProps}
        toolbar={
          <>
            <div>
              <Label htmlFor="user-search">Search</Label>
              <Input
                className="mt-1 w-48"
                id="user-search"
                onChange={(e) => setQDraft(e.target.value)}
                placeholder="Email or name"
                type="search"
                value={qDraft}
              />
            </div>
            <div>
              <Label htmlFor="user-role">Role</Label>
              <Select
                onValueChange={(v) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      page: 1,
                      role: (v === "_all_" ? null : v) as
                        | (typeof ROLES)[number]
                        | null,
                    }),
                  })
                }
                value={role ?? "_all_"}
              >
                <SelectTrigger className="mt-1 w-36" id="user-role">
                  <SelectValue placeholder="All roles" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">All roles</SelectItem>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <FilterSwitch
              checked={includeBanned}
              id="user-include-banned"
              label="Include banned"
              onCheckedChange={(checked) =>
                void navigate({
                  search: (prev) => ({
                    ...prev,
                    includeBanned: checked,
                    page: 1,
                  }),
                })
              }
            />
          </>
        }
      />

      <Pagination>
        {page <= 1 ? (
          <PaginationLink disabled>Previous</PaginationLink>
        ) : (
          <PaginationLink asChild>
            <Link
              from="/admin/users/"
              search={(prev) => ({ ...prev, page: page - 1 })}
              to="/admin/users"
            >
              Previous
            </Link>
          </PaginationLink>
        )}
        <PaginationStatus page={page} totalPages={totalPages} />
        {page >= totalPages ? (
          <PaginationLink disabled>Next</PaginationLink>
        ) : (
          <PaginationLink asChild>
            <Link
              from="/admin/users/"
              search={(prev) => ({ ...prev, page: page + 1 })}
              to="/admin/users"
            >
              Next
            </Link>
          </PaginationLink>
        )}
      </Pagination>
    </div>
  );
}
