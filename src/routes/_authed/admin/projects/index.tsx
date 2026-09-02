import {
  createFileRoute,
  Link,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { ExportCsvButton } from "#/components/export-csv-button";
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
import { defineCsvColumns, toCsv } from "#/lib/csv";
import { pageTitle } from "#/lib/page-title";
import { projectImageSrc } from "#/lib/project-image";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import { listPrograms } from "#/server/programs";
import {
  exportAdminProjects,
  listAdminProjects,
} from "#/server/projects-queries";

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

const COLUMNS = defineAdminColumns<Row>()([
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
    cardHeader: true,
    enableHiding: false,
    header: "Title",
    id: "title",
  },
  {
    accessorFn: (row) => STATUS_ORDER[row.status] ?? 99,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    header: "Status",
    id: "status",
    // Numeric, not text: same reasoning as the Teams column below, and as
    // inventory's Status column. The "10" sorts before "2" trap is latent
    // until a tenth status exists.
    sortingFn: "basic",
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
    // Numeric, not text: the locale-compare default would compare String(n),
    // where "10" sorts before "2".
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
]);

type ExportRow = Awaited<
  ReturnType<typeof exportAdminProjects>
>["rows"][number];

// Every meaningful field, independent of which columns the table shows. The
// listing's loader returns a summary; this reads from the export server fn,
// which widens the projection instead. defineCsvColumns<ExportRow>() fails
// npm run typecheck if a field of ExportRow has no column here, so a future
// field added to exportAdminProjectsAs's projection cannot silently miss the
// file.
const EXPORT_COLUMNS = defineCsvColumns<ExportRow>()([
  { header: "ID", key: "id", value: (row) => row.id },
  { header: "Title", key: "title", value: (row) => row.title },
  { header: "Status", key: "status", value: (row) => row.status },
  {
    header: "Description",
    key: "description",
    value: (row) => row.description,
  },
  { header: "Image URL", key: "imageUrl", value: (row) => row.imageUrl },
  {
    header: "Problem statement",
    key: "problemStatement",
    value: (row) => row.problemStatement,
  },
  {
    header: "Objectives",
    key: "objectives",
    value: (row) => row.objectives,
  },
  {
    header: "Min qualifications",
    key: "minQualifications",
    value: (row) => row.minQualifications,
  },
  {
    header: "Pref qualifications",
    key: "prefQualifications",
    value: (row) => row.prefQualifications,
  },
  { header: "URL", key: "url", value: (row) => row.url },
  {
    header: "License restrictions",
    key: "licenseRestrictions",
    value: (row) => row.licenseRestrictions,
  },
  {
    header: "NDA/IP required",
    key: "requiresNdaIp",
    value: (row) => row.requiresNdaIp,
  },
  {
    header: "Accepting applicants",
    key: "acceptingApplicants",
    value: (row) => row.acceptingApplicants,
  },
  { header: "Staff notes", key: "notes", value: (row) => row.notes },
  { header: "Categories", key: "categories", value: (row) => row.categories },
  {
    header: "Contact name",
    key: "contactName",
    value: (row) => row.contactName,
  },
  {
    header: "Contact email",
    key: "contactEmail",
    value: (row) => row.contactEmail,
  },
  { header: "Proposer ID", key: "proposerId", value: (row) => row.proposerId },
  {
    header: "Proposer name",
    key: "proposerName",
    value: (row) => row.proposerName,
  },
  {
    header: "Proposer email",
    key: "proposerEmail",
    value: (row) => row.proposerEmail,
  },
  { header: "Program ID", key: "programId", value: (row) => row.programId },
  {
    header: "Program course ID",
    key: "programCourseId",
    value: (row) => row.programCourseId,
  },
  {
    header: "Program course name",
    key: "programCourseName",
    value: (row) => row.programCourseName,
  },
  {
    header: "Teams supported",
    key: "teamsSupported",
    value: (row) => row.teamsSupported,
  },
  {
    header: "Student proposed",
    key: "studentProposed",
    value: (row) => row.studentProposed,
  },
  {
    header: "Seeking mentor",
    key: "seekingMentor",
    value: (row) => row.seekingMentor,
  },
  // The resolved name, not the address: the export reads the same projection
  // the public listing does, and mentorEmail is not in it. See #75.
  { header: "Mentor", key: "mentorName", value: (row) => row.mentorName },
  { header: "Created", key: "createdAt", value: (row) => row.createdAt },
  { header: "Published", key: "publishedAt", value: (row) => row.publishedAt },
  { header: "Archived", key: "archivedAt", value: (row) => row.archivedAt },
  { header: "Soft deleted", key: "deletedAt", value: (row) => row.deletedAt },
  { header: "Updated", key: "updatedAt", value: (row) => row.updatedAt },
]);

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
  const commitQuery = useCallback(
    (next: string) => {
      void navigate({ search: (prev) => ({ ...prev, q: next }) });
    },
    [navigate]
  );
  const [queryDraft, setQueryDraft] = useDebouncedDraft(q, commitQuery);

  const { orderRows, tableProps } = useAdminTable({
    columns: COLUMNS,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
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
        actions={
          <ExportCsvButton
            filename="projects"
            load={async () => {
              const { rows: exportRows } = await exportAdminProjects({
                data: {
                  includeSoftDeleted: search.includeSoftDeleted,
                  program: search.program,
                  proposer: search.proposer,
                  q: search.q,
                  status: search.status,
                },
              });
              // The export's rows are a wider projection of the same
              // records the table lists under the same filters, keyed by
              // the same id, so ordering by the table's sorted id sequence
              // still applies even though this array did not come from
              // `rows`.
              return toCsv(
                EXPORT_COLUMNS,
                orderRows(exportRows, (row) => row.id)
              );
            }}
          />
        }
        caption="Projects"
        data={rows}
        emptyMessage="No projects in this view."
        getRowId={(row) => row.id}
        {...tableProps}
        toolbar={
          <>
            <div>
              <Label htmlFor="admin-search">Search</Label>
              <Input
                className="mt-1 w-64"
                id="admin-search"
                onChange={(e) => setQueryDraft(e.target.value)}
                placeholder="Title, description, contact, or proposer"
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
