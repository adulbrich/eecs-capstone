import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  type AdminColumn,
  AdminDataTable,
} from "#/components/admin-data-table";
import { FilterSwitch } from "#/components/filter-switch";
import { ImageOrFallback } from "#/components/image-or-fallback";
import { LocalTime } from "#/components/local-time";
import { programLabel } from "#/components/project-card";
import { StatusBadge } from "#/components/status-badge";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { projectImageSrc } from "#/lib/project-image";
import {
  type AdminTableSearch,
  type SortState,
  useAdminTableState,
} from "#/lib/table-state";
import { listPrograms } from "#/server/programs";
import { listAdminProjects } from "#/server/projects-queries";

const STATUSES = [
  "all",
  "draft",
  "submitted",
  "approved",
  "changes_requested",
  "published",
  "archived",
] as const;

const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  includeSoftDeleted: z.boolean().default(false),
  program: z.string().uuid().nullable().default(null),
  // Better Auth user ids are text, not UUIDs.
  proposer: z.string().max(255).nullable().default(null),
  q: z.string().max(200).default(""),
  sort: z.string().optional(),
  status: z.enum(STATUSES).default("all"),
});

export const Route = createFileRoute("/_authed/admin/projects/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Projects") }] }),
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
    includeSoftDeleted: search.includeSoftDeleted,
    program: search.program,
    proposer: search.proposer,
    q: search.q,
    status: search.status,
  }),
  loader: async ({ deps }) =>
    await listAdminProjects({
      data: {
        includeSoftDeleted: deps.includeSoftDeleted,
        program: deps.program,
        proposer: deps.proposer,
        q: deps.q,
        status: deps.status,
      },
    }),
  component: AdminProjects,
});

type Row = Awaited<ReturnType<typeof listAdminProjects>>["rows"][number];

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  submitted: 1,
  changes_requested: 2,
  approved: 3,
  published: 4,
  archived: 5,
};

const DEFAULT_SORT: SortState = { desc: true, id: "updatedAt" };

const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.title,
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <ImageOrFallback
          className="aspect-[3/2] w-16 shrink-0 rounded object-cover"
          src={projectImageSrc(row.original.imageUrl)}
        />
        <Link
          className="hover:underline"
          params={{ projectId: row.original.id }}
          to="/projects/$projectId"
        >
          {row.original.title}
        </Link>
        {row.original.deletedAt && (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive text-xs">
            Deleted
          </span>
        )}
      </div>
    ),
    enableHiding: false,
    header: "Title",
    id: "title",
  },
  {
    accessorFn: (row) => STATUS_ORDER[row.status] ?? 99,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    header: "Status",
    id: "status",
  },
  {
    // Sorts on the name alone (not a name-or-email fallback), so an unlinked
    // proposal has no sort key and groups under `sortUndefined: "last"`
    // instead of being ordered by an email address that isn't even the
    // primary line the cell displays.
    accessorFn: (row) => row.proposerName ?? undefined,
    cell: ({ row }) => {
      const { proposerEmail, proposerName } = row.original;
      if (!(proposerName || proposerEmail)) {
        return "-";
      }
      if (!proposerName) {
        return proposerEmail;
      }
      return (
        <div className="leading-tight">
          <span className="block">{proposerName}</span>
          <span className="block text-muted-foreground text-xs">
            {proposerEmail}
          </span>
        </div>
      );
    },
    header: "Proposer",
    id: "proposer",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => programLabel(row) ?? undefined,
    cell: ({ row }) => programLabel(row.original) ?? "-",
    header: "Program",
    id: "program",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.updatedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.updatedAt} />,
    header: "Updated",
    id: "updatedAt",
    sortingFn: "datetime",
  },
  {
    accessorFn: (row) => row.contactName ?? row.contactEmail ?? undefined,
    cell: ({ row }) =>
      row.original.contactName ?? row.original.contactEmail ?? "-",
    defaultHidden: true,
    header: "Contact",
    id: "contact",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.teamsSupported,
    cell: ({ row }) => row.original.teamsSupported,
    defaultHidden: true,
    header: "Teams",
    id: "teams",
    // Numeric, not text: the "text" default would compare String(n), where
    // "10" sorts before "2".
    sortingFn: "basic",
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
    accessorFn: (row) => row.publishedAt ?? undefined,
    cell: ({ row }) =>
      row.original.publishedAt ? (
        <LocalTime dateOnly value={row.original.publishedAt} />
      ) : (
        "-"
      ),
    defaultHidden: true,
    header: "Published",
    id: "publishedAt",
    sortingFn: "datetime",
    sortUndefined: "last",
  },
  {
    cell: ({ row }) => (
      <Link
        className="hover:underline"
        params={{ projectId: row.original.id }}
        to="/projects/$projectId/edit"
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

function AdminProjects() {
  const { rows, proposers } = Route.useLoaderData();
  // The whole search object goes to the hook, which reads cols/dir/sort.
  const search = Route.useSearch();
  const { includeSoftDeleted, program, proposer, q, status } = search;
  const navigate = useNavigate({ from: "/admin/projects/" });
  const [allPrograms, setAllPrograms] = useState<
    { courseId: string; courseName: string; id: string }[]
  >([]);

  useEffect(() => {
    void (async () => {
      try {
        const { rows: progs } = await listPrograms();
        setAllPrograms(progs);
      } catch {
        // Filter degrades to "All programs" if the list cannot be loaded.
      }
    })();
  }, []);

  // Debounced URL sync, matching the public listing's filter bar: the input is
  // local so typing stays responsive, and the URL (and therefore the loader)
  // catches up once the user pauses.
  const [queryDraft, setQueryDraft] = useState(q);
  useEffect(() => setQueryDraft(q), [q]);
  useEffect(() => {
    const t = setTimeout(() => {
      if (queryDraft !== q) {
        void navigate({ search: (prev) => ({ ...prev, q: queryDraft }) });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [queryDraft, q, navigate]);

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
    storageKey: "projects",
  });

  // The chosen proposer can fall outside the current status/program/deleted
  // scope, which would leave the Select showing a blank trigger. Keep the row
  // count honest by surfacing it as a still-selected option.
  const proposerMissing =
    !!proposer && !proposers.some((p) => p.id === proposer);

  const label = (s: string) => s.replace(/_/g, " ");

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
            <BreadcrumbPage>Projects</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Projects</h1>

      <AdminDataTable
        caption="Projects"
        columns={COLUMNS}
        data={rows}
        defaultSort={DEFAULT_SORT}
        emptyMessage="No projects in this view."
        getRowId={(row) => row.id}
        hidden={hidden}
        onHiddenChange={onHiddenChange}
        onSortChange={onSortChange}
        sort={sort}
        storageKey="projects"
        toolbar={
          <>
            <div>
              <Label htmlFor="admin-search">Search</Label>
              <Input
                className="mt-1 w-64"
                id="admin-search"
                onChange={(e) => setQueryDraft(e.target.value)}
                placeholder="Search titles and descriptions"
                type="search"
                value={queryDraft}
              />
            </div>
            <div>
              <Label htmlFor="admin-filter-status">Status</Label>
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
                <SelectTrigger className="mt-1 w-48" id="admin-filter-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s === "all" ? "All statuses" : label(s)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="admin-filter-program">Program</Label>
              <Select
                onValueChange={(v) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      program: v === "_all_" ? null : v,
                    }),
                  })
                }
                value={program ?? "_all_"}
              >
                <SelectTrigger className="mt-1 w-56" id="admin-filter-program">
                  <SelectValue placeholder="All programs" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">All programs</SelectItem>
                  {allPrograms.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.courseId} {p.courseName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="admin-filter-proposer">Proposer</Label>
              <Select
                onValueChange={(v) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      proposer: v === "_all_" ? null : v,
                    }),
                  })
                }
                value={proposer ?? "_all_"}
              >
                <SelectTrigger className="mt-1 w-56" id="admin-filter-proposer">
                  <SelectValue placeholder="All proposers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">All proposers</SelectItem>
                  {proposers.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} ({p.email})
                    </SelectItem>
                  ))}
                  {proposerMissing && proposer && (
                    <SelectItem value={proposer}>
                      Selected proposer (outside current filters)
                    </SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <FilterSwitch
              checked={includeSoftDeleted}
              id="admin-include-soft-deleted"
              label="Show soft-deleted"
              onCheckedChange={(checked) =>
                void navigate({
                  search: (prev) => ({ ...prev, includeSoftDeleted: checked }),
                })
              }
            />
          </>
        }
      />
    </div>
  );
}
