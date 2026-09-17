import {
  createFileRoute,
  Link,
  redirect,
  stripSearchParams,
  useNavigate,
} from "@tanstack/react-router";
import { useCallback, useId } from "react";
import { z } from "zod";
import {
  AdminDataTable,
  AdminTableControls,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { ClearFiltersButton } from "#/components/clear-filters-button";
import { ExportCsvButton } from "#/components/export-csv-button";
import { FilterSwitch } from "#/components/filter-switch";
import { ImageOrFallback } from "#/components/image-or-fallback";
import { ListingLayout } from "#/components/listing-layout";
import { LocalTime } from "#/components/local-time";
import { programCourseIds } from "#/components/project-card";
import {
  type FilterProgram,
  PROJECT_SWITCH_HINT,
  PROJECT_SWITCH_LABEL,
  PROJECT_SWITCH_LEGEND,
} from "#/components/projects-filters";
import {
  type FilterProposer,
  ProposerFilterCombobox,
} from "#/components/proposer-filter-combobox";
import { SearchHint } from "#/components/search-hint";
import { StatusBadge } from "#/components/status-badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
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
import {
  ADMIN_DATE_FIELD_LABEL,
  ADMIN_DATE_FIELDS,
  type AdminDateField,
  DEFAULT_ADMIN_STATUSES,
  isDefaultStatusSelection,
  PROGRAM_FILTER_NONE,
  statusSelectionLabel,
  toggleStatus,
} from "#/lib/admin-project-filters";
import { getSession } from "#/lib/auth-guards";
import { defineCsvColumns, toCsv } from "#/lib/csv";
import { pageTitle } from "#/lib/page-title";
import { projectImageSrc } from "#/lib/project-image";
import {
  PROJECT_STATUS_DISPLAY_RANK,
  PROJECT_STATUS_LABEL,
} from "#/lib/project-workflow";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { useDebouncedDraft } from "#/lib/use-debounced-draft";
import { isStaff } from "#/lib/viewer";
import { PROJECT_STATUSES, type ProjectStatus } from "#/lib/vocabularies";
import { listPrograms } from "#/server/programs";
import {
  exportAdminProjects,
  listAdminProjects,
} from "#/server/projects-queries";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The five switches, off. Stripped from the URL when they match, so a shared
 * link carries only what is on (#340): the router writes every validated
 * default back on navigation otherwise, and a `false` written by the spread
 * of `prev` would survive a switch set to `undefined`.
 */
const SWITCH_DEFAULTS = {
  acceptingOnly: false,
  includeSoftDeleted: false,
  requiresNdaOnly: false,
  studentProposedOnly: false,
  withoutMentorOnly: false,
};

/**
 * The one narrowing switch this page does not share with `/projects`: the
 * mentor is staff information, so the public listing has no switch on it
 * (#402). With "Student proposed" it is the staff to-do that `/admin/mentors`
 * is matched against.
 */
const WITHOUT_MENTOR_LABEL = "have no mentor recorded";

export const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  includeSoftDeleted: z.boolean().default(SWITCH_DEFAULTS.includeSoftDeleted),
  // Three states, one field: absent is every program, "none" is the projects
  // nobody has filed yet, a UUID is that program (#458). `.catch` for the same
  // reason the four below carry one: a stale or hand-edited link degrades to
  // "All programs" rather than erroring the route.
  program: z
    .union([z.literal(PROGRAM_FILTER_NONE), z.string().uuid()])
    .nullable()
    .default(null)
    .catch(null),
  // Better Auth user ids are text, not UUIDs.
  proposer: z.string().max(255).nullable().default(null),
  q: z.string().max(200).default(""),
  sort: z.string().optional(),
  // Absent is the default set, every status but archived; any explicit
  // choice is spelled out in full. `.catch` on the four so a stale or
  // hand-edited link degrades to the default rather than a route error.
  status: z.array(z.enum(PROJECT_STATUSES)).min(1).optional().catch(undefined),
  from: z.string().regex(DAY).optional().catch(undefined),
  to: z.string().regex(DAY).optional().catch(undefined),
  dateField: z.enum(ADMIN_DATE_FIELDS).catch("published").default("published"),
  // Three of the public listing's four switches under the same names, so a
  // link pasted from /projects narrows this page the same way (#340); the
  // fourth, archived, is a status here. The last is this page's own.
  acceptingOnly: z.boolean().default(SWITCH_DEFAULTS.acceptingOnly),
  studentProposedOnly: z.boolean().default(SWITCH_DEFAULTS.studentProposedOnly),
  requiresNdaOnly: z.boolean().default(SWITCH_DEFAULTS.requiresNdaOnly),
  withoutMentorOnly: z.boolean().default(SWITCH_DEFAULTS.withoutMentorOnly),
});

type Search = z.infer<typeof searchSchema>;

/**
 * The filter the loader and the export send, from the URL: the status set
 * resolved from its absent default, and a reversed date pair swapped, as
 * `/admin/analytics` does.
 */
export function resolveAdminFilter(search: Search) {
  const reversed = search.from && search.to && search.from > search.to;
  return {
    acceptingOnly: search.acceptingOnly,
    dateField: search.dateField,
    from: (reversed ? search.to : search.from) ?? null,
    includeSoftDeleted: search.includeSoftDeleted,
    program: search.program,
    proposer: search.proposer,
    q: search.q,
    requiresNdaOnly: search.requiresNdaOnly,
    statuses: search.status ?? [...DEFAULT_ADMIN_STATUSES],
    studentProposedOnly: search.studentProposedOnly,
    to: (reversed ? search.from : search.to) ?? null,
    withoutMentorOnly: search.withoutMentorOnly,
  };
}

/**
 * How many controls are on: what the Filters button shows below xl, and
 * what decides whether Clear all renders. The search is excluded, since it
 * sits beside the button. The soft-deleted switch is in: it is a control
 * the reader turned on, whether or not it narrows. The default status set
 * is the listing, not a filter (#335), and the date field alone counts for
 * nothing until a bound is set. Clear all resets exactly these fields.
 */
function countActiveAdminFilters(search: Search): number {
  const resolved = resolveAdminFilter(search);
  return [
    !isDefaultStatusSelection(resolved.statuses),
    resolved.from !== null || resolved.to !== null,
    search.program !== null,
    search.proposer !== null,
    search.acceptingOnly,
    search.studentProposedOnly,
    search.requiresNdaOnly,
    search.withoutMentorOnly,
    search.includeSoftDeleted,
  ].filter(Boolean).length;
}

export const Route = createFileRoute("/_authed/admin/projects/")({
  validateSearch: searchSchema,
  search: { middlewares: [stripSearchParams(SWITCH_DEFAULTS)] },
  head: () => ({ meta: [{ title: pageTitle("Projects") }] }),
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
  loaderDeps: ({ search }) => resolveAdminFilter(search),
  // Programs load with the rows rather than in a mount effect, so the
  // filters aside paints complete.
  loader: async ({ deps }) => {
    const [result, { rows: programs }] = await Promise.all([
      listAdminProjects({ data: deps }),
      listPrograms(),
    ]);
    return { ...result, programs };
  },
  component: AdminProjects,
});

type Row = Awaited<ReturnType<typeof listAdminProjects>>["rows"][number];

const DEFAULT_SORT: SortState = { desc: true, id: "updatedAt" };

/** The hint line under the search input, which names it; see `SearchHint`. */
const SEARCH_HINT_ID = "admin-search-hint";

const COLUMNS = defineAdminColumns<Row>()([
  {
    accessorFn: (row) => row.title,
    cell: ({ row }) => (
      <div className="flex items-center gap-2 md:min-w-xs md:max-w-md">
        <ImageOrFallback
          className="aspect-[3/2] w-16 shrink-0 rounded object-cover"
          src={projectImageSrc(row.original.imageUrl)}
        />
        <Link
          className="min-w-0 hover:underline md:line-clamp-2 md:whitespace-normal"
          params={{ projectId: row.original.id }}
          title={row.original.title}
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
    accessorFn: (row) =>
      PROJECT_STATUS_DISPLAY_RANK[row.status as ProjectStatus] ?? 99,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    header: "Status",
    id: "status",
    // Numeric, not text: same reasoning as the Teams column below, and as
    // inventory's Status column. The "10" sorts before "2" trap is latent
    // until a tenth status exists.
    sortFn: "basic",
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
    // The same course ids the public table and the card meta line show, so
    // the two listings read alike (#462).
    accessorFn: (row) => programCourseIds(row) ?? undefined,
    cell: ({ row }) => programCourseIds(row.original) ?? "-",
    header: "Program",
    id: "program",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.updatedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.updatedAt} />,
    header: "Updated",
    id: "updatedAt",
    sortFn: "datetime",
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
    sortFn: "basic",
  },
  {
    accessorFn: (row) => row.createdAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
    defaultHidden: true,
    header: "Created",
    id: "createdAt",
    sortFn: "datetime",
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
    sortFn: "datetime",
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
    header: "Openings",
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
  // One cell, the course ids `'; '` separated, in place of the id and the
  // two label columns a single program had. A break for anyone keyed on the
  // old headers, taken with #462: a spreadsheet loses the course names, and
  // the course id is what staff sort and pivot on.
  { header: "Programs", key: "programs", value: (row) => row.programs },
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
  // The resolved name, not the address: the export reads the same projection
  // the public listing does, and mentorEmail is not in it. See #75.
  { header: "Mentor", key: "mentorName", value: (row) => row.mentorName },
  { header: "Created", key: "createdAt", value: (row) => row.createdAt },
  { header: "Published", key: "publishedAt", value: (row) => row.publishedAt },
  { header: "Archived", key: "archivedAt", value: (row) => row.archivedAt },
  { header: "Soft deleted", key: "deletedAt", value: (row) => row.deletedAt },
  { header: "Updated", key: "updatedAt", value: (row) => row.updatedAt },
]);

/**
 * The narrowing form. Its own component, not JSX built in the route, because
 * ListingLayout mounts it twice (aside and sheet) and each mount needs its
 * own `useId` set: one id set built in the parent is duplicated across both
 * copies, and every label then resolves to the hidden aside copy.
 */
function AdminProjectsFilters({
  programs,
  proposers,
}: {
  programs: FilterProgram[];
  proposers: FilterProposer[];
}) {
  const uid = useId();
  const navigate = useNavigate({ from: "/admin/projects/" });
  const search = Route.useSearch();
  const resolved = resolveAdminFilter(search);
  // The default set travels as an absent param, any other set in full.
  const setStatuses = (statuses: ProjectStatus[]) =>
    void navigate({
      search: (prev) => ({
        ...prev,
        status: isDefaultStatusSelection(statuses) ? undefined : statuses,
      }),
    });
  const {
    acceptingOnly,
    includeSoftDeleted,
    program,
    proposer,
    requiresNdaOnly,
    studentProposedOnly,
    withoutMentorOnly,
  } = search;
  return (
    <div className="space-y-4">
      <fieldset>
        <legend className="font-medium text-muted-foreground text-xs">
          Status
        </legend>
        <p className="mt-0.5 text-muted-foreground text-xs">
          {statusSelectionLabel(resolved.statuses)}
        </p>
        <div className="mt-1 space-y-1">
          {PROJECT_STATUSES.map((s) => {
            const checked = resolved.statuses.includes(s);
            return (
              <Label className="min-h-7 font-normal" key={s}>
                <Checkbox
                  checked={checked}
                  // The last checked status cannot be unchecked, so the
                  // empty set never exists.
                  disabled={checked && resolved.statuses.length === 1}
                  onCheckedChange={() =>
                    setStatuses(toggleStatus(resolved.statuses, s))
                  }
                />
                {PROJECT_STATUS_LABEL[s]}
              </Label>
            );
          })}
        </div>
      </fieldset>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-program`}>Program</Label>
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
          <SelectTrigger className="w-full" id={`${uid}-program`}>
            <SelectValue placeholder="All programs" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="_all_">All programs</SelectItem>
            {/*
              No sentinel, unlike "_all_" above: "none" is the value the URL
              actually carries, where "all" is the absent param (#458).
            */}
            <SelectItem value={PROGRAM_FILTER_NONE}>No program</SelectItem>
            {programs.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.courseId} {p.courseName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-proposer`}>Proposer</Label>
        <ProposerFilterCombobox
          id={`${uid}-proposer`}
          onChange={(next) =>
            void navigate({
              search: (prev) => ({ ...prev, proposer: next }),
            })
          }
          proposers={proposers}
          value={proposer ?? null}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`${uid}-date-field`}>Date</Label>
        <Select
          onValueChange={(v) =>
            void navigate({
              search: (prev) => ({
                ...prev,
                dateField: v as AdminDateField,
              }),
            })
          }
          value={resolved.dateField}
        >
          <SelectTrigger className="w-full" id={`${uid}-date-field`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ADMIN_DATE_FIELDS.map((f) => (
              <SelectItem key={f} value={f}>
                {ADMIN_DATE_FIELD_LABEL[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-from`}>From</Label>
          <Input
            className="w-full"
            id={`${uid}-from`}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  from: e.target.value || undefined,
                }),
              })
            }
            type="date"
            value={resolved.from ?? ""}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${uid}-to`}>To</Label>
          <Input
            className="w-full"
            id={`${uid}-to`}
            onChange={(e) =>
              void navigate({
                search: (prev) => ({
                  ...prev,
                  to: e.target.value || undefined,
                }),
              })
            }
            type="date"
            value={resolved.to ?? ""}
          />
        </div>
      </div>
      {(resolved.from !== null || resolved.to !== null) && (
        <Button
          onClick={() =>
            void navigate({
              search: (prev) => ({
                ...prev,
                from: undefined,
                to: undefined,
              }),
            })
          }
          size="sm"
          type="button"
          variant="ghost"
        >
          Clear dates
        </Button>
      )}
      <fieldset>
        {/*
          Three of the public listing's four switches, under the same params,
          so a link pasted from /projects narrows this page the same way
          (#340). The fourth, archived, is a status here. The last switch is
          this page's own (#402).
          Labels are one line each under the legend, so each fits the aside
          beside its switch. An off switch leaves the URL: see SWITCH_DEFAULTS.
        */}
        <legend className="font-medium text-muted-foreground text-xs">
          {PROJECT_SWITCH_LEGEND}
        </legend>
        <div className="mt-1">
          <FilterSwitch
            checked={acceptingOnly}
            hint={PROJECT_SWITCH_HINT.acceptingOnly}
            id={`${uid}-accepting-only`}
            label={PROJECT_SWITCH_LABEL.acceptingOnly}
            onCheckedChange={(checked) =>
              void navigate({
                search: (prev) => ({ ...prev, acceptingOnly: checked }),
              })
            }
          />
          <FilterSwitch
            checked={studentProposedOnly}
            id={`${uid}-student-proposed-only`}
            label={PROJECT_SWITCH_LABEL.studentProposedOnly}
            onCheckedChange={(checked) =>
              void navigate({
                search: (prev) => ({ ...prev, studentProposedOnly: checked }),
              })
            }
          />
          <FilterSwitch
            checked={requiresNdaOnly}
            id={`${uid}-requires-nda-only`}
            label={PROJECT_SWITCH_LABEL.requiresNdaOnly}
            onCheckedChange={(checked) =>
              void navigate({
                search: (prev) => ({ ...prev, requiresNdaOnly: checked }),
              })
            }
          />
          <FilterSwitch
            checked={withoutMentorOnly}
            id={`${uid}-without-mentor-only`}
            label={WITHOUT_MENTOR_LABEL}
            onCheckedChange={(checked) =>
              void navigate({
                search: (prev) => ({ ...prev, withoutMentorOnly: checked }),
              })
            }
          />
        </div>
      </fieldset>
      {/* Outside the legend: it widens the view rather than narrowing it. */}
      <FilterSwitch
        checked={includeSoftDeleted}
        id={`${uid}-include-soft-deleted`}
        label="Show soft-deleted"
        onCheckedChange={(checked) =>
          void navigate({
            search: (prev) => ({ ...prev, includeSoftDeleted: checked }),
          })
        }
      />
      {countActiveAdminFilters(search) > 0 && (
        <ClearFiltersButton
          onClick={() =>
            void navigate({
              // Every field the count reads, to its default; the search,
              // sort and column state ride along in `prev`. The soft-deleted
              // switch goes too, since the button counts it (#355).
              search: (prev) => ({
                ...prev,
                acceptingOnly: false,
                dateField: "published",
                from: undefined,
                includeSoftDeleted: false,
                program: null,
                proposer: null,
                requiresNdaOnly: false,
                status: undefined,
                studentProposedOnly: false,
                to: undefined,
                withoutMentorOnly: false,
              }),
            })
          }
        />
      )}
    </div>
  );
}

/**
 * Says how many rows the date range is hiding because they have no date at
 * all, rather than because they fall outside it.
 *
 * `published` and `archived` are nullable, so a range on either drops those
 * rows with nothing in the result to say so. Before the legacy import a null
 * meant "a draft, never published" and was rare enough to live as a note in
 * the query (#335); 302 of the 547 imported projects have no publish date and
 * 264 have no archive date, so the quiet answer is now the wrong one often
 * enough to show.
 */
function DatelessNotice({
  count,
  dateField,
}: {
  count: number;
  dateField: AdminDateField;
}) {
  const navigate = useNavigate({ from: "/admin/projects/" });
  if (count === 0) {
    return null;
  }
  const label = ADMIN_DATE_FIELD_LABEL[dateField].toLowerCase();
  return (
    // `mt-4` to match `AdminDataTable`'s own top margin: `ListingLayout`
    // renders its children straight after the controls row with no spacing of
    // its own, so each block brings its own.
    <div className="mt-4 rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
      <p className="text-muted-foreground">
        {count === 1
          ? `1 project in this view has no ${label} date and is not shown.`
          : `${count} projects in this view have no ${label} date and are not shown.`}{" "}
        A project has no {label} date if it never reached that point, or if it
        was imported from the legacy portal, whose event log only goes back to
        August 2022.
      </p>
      <ClearFiltersButton
        className="mt-2"
        onClick={() =>
          void navigate({
            search: (prev) => ({ ...prev, from: undefined, to: undefined }),
          })
        }
      >
        Clear the date range
      </ClearFiltersButton>
    </div>
  );
}

function AdminProjects() {
  const { datelessInScope, rows, proposers, programs } = Route.useLoaderData();
  // The whole search object goes to the hook, which reads cols/dir/sort.
  const search = Route.useSearch();
  const {
    acceptingOnly,
    program,
    proposer,
    q,
    requiresNdaOnly,
    studentProposedOnly,
    withoutMentorOnly,
  } = search;
  const resolved = resolveAdminFilter(search);
  // Narrowing only: the soft-deleted switch widens the view, so an empty
  // result with it on is still "nothing at all". The default status set
  // is the listing, not a filter (#335), and the date field alone narrows
  // nothing until a bound is set.
  const filtered =
    q !== "" ||
    !isDefaultStatusSelection(resolved.statuses) ||
    resolved.from !== null ||
    resolved.to !== null ||
    program !== null ||
    proposer !== null ||
    acceptingOnly ||
    studentProposedOnly ||
    requiresNdaOnly ||
    withoutMentorOnly;
  const activeFilterCount = countActiveAdminFilters(search);
  const navigate = useNavigate({ from: "/admin/projects/" });

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

  const { controlsProps, orderRows, tableProps } = useAdminTable({
    columns: COLUMNS,
    defaultSort: DEFAULT_SORT,
    navigate,
    search,
    storageKey: "projects",
  });

  return (
    <ListingLayout
      activeFilterCount={activeFilterCount}
      filters={
        <AdminProjectsFilters programs={programs} proposers={proposers} />
      }
      search={
        <>
          <Label className="sr-only" htmlFor="admin-search">
            Search
          </Label>
          <Input
            aria-describedby={SEARCH_HINT_ID}
            className="min-w-0 flex-1 basis-64"
            id="admin-search"
            onChange={(e) => setQueryDraft(e.target.value)}
            placeholder="Search projects"
            type="search"
            value={queryDraft}
          />
          <SearchHint
            fields="titles, descriptions, problem statements, objectives, qualifications, contacts and proposers"
            id={SEARCH_HINT_ID}
          />
        </>
      }
      tableControls={
        <AdminTableControls
          actions={
            <ExportCsvButton
              filename="projects"
              load={async () => {
                // The same resolved filter the loader sent, so the file
                // can never disagree with the table about which rows
                // match.
                const { rows: exportRows } = await exportAdminProjects({
                  data: resolved,
                });
                // The export's rows are a wider projection of the same
                // records the table lists under the same filters, keyed
                // by the same id, so ordering by the table's sorted id
                // sequence still applies even though this array did not
                // come from `rows`.
                return toCsv(
                  EXPORT_COLUMNS,
                  orderRows(exportRows, (row) => row.id)
                );
              }}
            />
          }
          filtered={filtered}
          rowCount={rows.length}
          {...controlsProps}
        />
      }
      title={
        <>
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
        </>
      }
    >
      <DatelessNotice count={datelessInScope} dateField={resolved.dateField} />
      <AdminDataTable
        caption="Projects"
        controls="listing"
        data={rows}
        emptyMessage="No projects yet."
        filtered={filtered}
        getRowId={(row) => row.id}
        noMatchMessage="No projects in this view."
        {...tableProps}
      />
      <ListCount count={rows.length} />
    </ListingLayout>
  );
}
