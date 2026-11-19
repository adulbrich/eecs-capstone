import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { LocalTime } from "#/components/local-time";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "#/components/ui/breadcrumb";
import { Card } from "#/components/ui/card";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { requireStaff } from "#/lib/access-denied";
import { bookmarksPer, slotsHint } from "#/lib/analytics-copy";
import { pageTitle } from "#/lib/page-title";
import { PROJECT_STATUS_LABEL } from "#/lib/project-workflow";
import { resolveRange } from "#/lib/report-range";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import type {
  InventoryRequestItemStatus,
  ItemStatus,
  UserRole,
} from "#/lib/vocabularies";
import { getAnalytics } from "#/server/analytics";
import { listPrograms } from "#/server/programs";

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;

/** The wrapper's return type, so the route never reaches into `_internal`. */
type AnalyticsView = Awaited<ReturnType<typeof getAnalytics>>;
type Flow = AnalyticsView["flows"]["submitted"];
type Bucket = AnalyticsView["breakdowns"]["projectsByStatus"][number];
type ProjectDemand = AnalyticsView["bookmarksByProject"][number];
type CategoryDemand = AnalyticsView["bookmarksByCategory"][number];

/**
 * The page controls and the per-project table's sort live in the URL so a
 * view is a link staff can share. Defaults: the last thirty days, every
 * program, most bookmarks per team first. The category table sorts in place
 * and forgets it on reload.
 */
const searchSchema = z.object({
  // `.catch` on every one, so a stale or hand-edited link degrades to the
  // default rather than a route error.
  from: z.string().regex(DATE).optional().catch(undefined),
  to: z.string().regex(DATE).optional().catch(undefined),
  program: z.string().uuid().nullable().catch(null).default(null),
  sort: z.string().optional().catch(undefined),
  dir: z.enum(["asc", "desc"]).optional().catch(undefined),
  cols: z.string().optional().catch(undefined),
});

export const Route = createFileRoute("/_authed/admin/analytics")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Analytics") }] }),
  beforeLoad: ({ context }) => {
    requireStaff(context.user);
  },
  loaderDeps: ({ search }) => ({
    from: search.from,
    program: search.program,
    to: search.to,
  }),
  loader: async ({ deps }) => {
    const range = resolveRange(deps);
    const [view, { rows: programs }] = await Promise.all([
      getAnalytics({ data: { ...range, programId: deps.program } }),
      listPrograms(),
    ]);
    return { view, programs, range };
  },
  component: AnalyticsPage,
});

// Keyed by the vocabulary, not by string, so a status added to the tuple and
// not here fails to compile rather than drawing a row labelled with its raw
// key (#286). The project labels come from `project-workflow.ts`, shared with
// the badge and the stepper (#303); the inventory ones are still local.

const ITEM_STATUS_LABEL: Record<ItemStatus, string> = {
  available: "Available",
  requested: "Requested",
  reserved: "Reserved",
  checked_out: "Checked out",
  maintenance: "Maintenance",
  retired: "Retired",
};

const LINE_STATUS_LABEL: Record<InventoryRequestItemStatus, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  returned: "Returned",
};

const ROLE_LABEL: Record<UserRole, string> = {
  admin: "Admin",
  instructor: "Instructor",
  user: "User",
};

const COUNT = new Intl.NumberFormat("en-US");
const ONE_PLACE = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});

/** A ratio to one place, or "-" where there are no teams to divide by. */
function ratio(value: number | undefined): string {
  return value === undefined ? "-" : ONE_PLACE.format(value);
}

const PROJECT_DEMAND_COLUMNS = defineAdminColumns<ProjectDemand>()([
  {
    accessorFn: (row) => row.title,
    cardHeader: true,
    // The free-text title recipe (docs/UI-CONVENTIONS.md, "A free-text
    // column is bounded and clamped"), so a long title cannot push the
    // counts off the table.
    cell: ({ row }) => (
      <div className="flex md:max-w-md md:min-w-xs">
        <Link
          className="text-brand-dark min-w-0 underline md:line-clamp-2 md:whitespace-normal"
          params={{ projectId: row.original.id }}
          title={row.original.title}
          to="/projects/$projectId"
        >
          {row.original.title}
        </Link>
      </div>
    ),
    enableHiding: false,
    header: "Project",
    id: "title",
  },
  {
    accessorFn: (row) => row.bookmarks,
    cell: ({ row }) => COUNT.format(row.original.bookmarks),
    enableHiding: false,
    header: "Bookmarks",
    id: "bookmarks",
    sortFn: "basic",
  },
  {
    accessorFn: (row) => row.teamsSupported,
    cell: ({ row }) => COUNT.format(row.original.teamsSupported),
    enableHiding: false,
    header: "Teams",
    id: "teams",
    sortFn: "basic",
  },
  {
    accessorFn: (row) => bookmarksPer(row.bookmarks, row.teamsSupported),
    cell: ({ row }) =>
      ratio(bookmarksPer(row.original.bookmarks, row.original.teamsSupported)),
    enableHiding: false,
    header: "Per team",
    headerHint: "Bookmarks divided by the teams the project supports.",
    id: "perTeam",
    sortFn: "basic",
    sortUndefined: "last",
  },
]);

const PROJECT_DEMAND_DEFAULT_SORT: SortState = { desc: true, id: "perTeam" };

const CATEGORY_DEMAND_COLUMNS = defineAdminColumns<CategoryDemand>()([
  {
    accessorFn: (row) => row.label,
    cardHeader: true,
    enableHiding: false,
    header: "Category",
    id: "label",
  },
  {
    accessorFn: (row) => row.projects,
    cell: ({ row }) => COUNT.format(row.original.projects),
    enableHiding: false,
    header: "Projects",
    id: "projects",
    sortFn: "basic",
  },
  {
    accessorFn: (row) => row.slots,
    cell: ({ row }) => COUNT.format(row.original.slots),
    enableHiding: false,
    header: "Team slots",
    id: "slots",
    sortFn: "basic",
  },
  {
    accessorFn: (row) => row.bookmarks,
    cell: ({ row }) => COUNT.format(row.original.bookmarks),
    enableHiding: false,
    header: "Bookmarks",
    id: "bookmarks",
    sortFn: "basic",
  },
  {
    accessorFn: (row) => bookmarksPer(row.bookmarks, row.slots),
    cell: ({ row }) =>
      ratio(bookmarksPer(row.original.bookmarks, row.original.slots)),
    enableHiding: false,
    header: "Per slot",
    headerHint: "Bookmarks divided by the category's team slots.",
    id: "perSlot",
    sortFn: "basic",
    sortUndefined: "last",
  },
]);

const CATEGORY_DEMAND_DEFAULT_SORT: SortState = { desc: true, id: "perSlot" };

/**
 * The category table sorts in place: the URL's sort belongs to the
 * per-project table, and two tables cannot share it. Nothing to hide, so no
 * Columns menu.
 */
function CategoryDemandTable({ rows }: { rows: CategoryDemand[] }) {
  const [sort, setSort] = useState(CATEGORY_DEMAND_DEFAULT_SORT);
  return (
    <AdminDataTable
      caption="Bookmarks against team slots per category"
      columns={CATEGORY_DEMAND_COLUMNS}
      data={rows}
      defaultSort={CATEGORY_DEMAND_DEFAULT_SORT}
      emptyMessage="No published project has a category."
      getRowId={(row) => row.key}
      hidden={[]}
      onHiddenChange={() => undefined}
      onSortChange={setSort}
      sort={sort}
      storageKey="analytics-categories"
    />
  );
}

function daysSince(date: Date | string | null): string | null {
  if (!date) {
    return null;
  }
  const days = Math.floor((Date.now() - new Date(date).getTime()) / DAY_MS);
  if (days <= 0) {
    return "today";
  }
  return days === 1 ? "1 day" : `${days} days`;
}

function Figure({
  hint,
  label,
  scope,
  value,
}: {
  hint?: string | null;
  label: string;
  scope: "program" | "global";
  value: number | string;
}) {
  return (
    <Card className="p-4">
      <p className="text-muted-foreground flex items-baseline justify-between gap-2 text-sm">
        <span>{label}</span>
        {/* Named on every card so the controls are not read as doing
            something they are not: a global figure ignores the program. */}
        <span className="text-xs">
          {scope === "program" ? "per program" : "global"}
        </span>
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {hint && <p className="text-muted-foreground mt-0.5 text-xs">{hint}</p>}
    </Card>
  );
}

function FlowCard({
  flow,
  label,
  scope,
}: {
  flow: Flow;
  label: string;
  scope: "program" | "global";
}) {
  const delta = flow.current - flow.previous;
  const direction = (() => {
    if (delta > 0) {
      return `up ${delta}`;
    }
    if (delta < 0) {
      return `down ${-delta}`;
    }
    return "no change";
  })();
  return (
    <Figure
      hint={`${flow.previous} in the previous period, ${direction}`}
      label={label}
      scope={scope}
      value={flow.current}
    />
  );
}

function Breakdown({
  labels,
  rows,
  scope,
  title,
}: {
  labels?: Record<string, string>;
  rows: Bucket[];
  scope: "program" | "global";
  title: string;
}) {
  return (
    <Card className="p-4">
      <p className="flex items-baseline justify-between gap-2 text-sm">
        <span className="font-medium">{title}</span>
        <span className="text-muted-foreground text-xs">
          {scope === "program" ? "per program" : "global"}
        </span>
      </p>
      {rows.length === 0 ? (
        <p className="text-muted-foreground mt-2 text-sm">Nothing yet.</p>
      ) : (
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          {rows.map((row) => (
            <div className="contents" key={row.key}>
              <dt className="text-muted-foreground">
                {labels?.[row.key] ?? row.key}
              </dt>
              <dd className="text-right tabular-nums">{row.count}</dd>
            </div>
          ))}
        </dl>
      )}
    </Card>
  );
}

function SectionHeading({
  children,
  note,
}: {
  children: string;
  note?: string;
}) {
  return (
    <div className="mt-8 flex flex-wrap items-baseline justify-between gap-2">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {children}
      </h2>
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
    </div>
  );
}

function AnalyticsPage() {
  const { view, programs, range } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const h = view.headline;
  const { tableProps } = useAdminTable({
    columns: PROJECT_DEMAND_COLUMNS,
    defaultSort: PROJECT_DEMAND_DEFAULT_SORT,
    navigate,
    search,
    storageKey: "analytics-bookmarks",
  });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link to="/admin">Admin</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>Analytics</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 text-2xl font-semibold">Analytics</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        What is in the database, as of <LocalTime value={view.asOf} />. The date
        range governs the flows only; the program selector governs every figure
        marked per program.
      </p>

      <Card className="mt-4 grid gap-3 bg-transparent p-4 md:grid-cols-3">
        <div className="space-y-1.5">
          <Label htmlFor="analytics-from">From</Label>
          <Input
            id="analytics-from"
            onChange={(e) =>
              navigate({
                search: (s) => ({ ...s, from: e.target.value || undefined }),
              })
            }
            type="date"
            value={range.from}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="analytics-to">To</Label>
          <Input
            id="analytics-to"
            onChange={(e) =>
              navigate({
                search: (s) => ({ ...s, to: e.target.value || undefined }),
              })
            }
            type="date"
            value={range.to}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="analytics-program">Program</Label>
          <Select
            onValueChange={(v) =>
              navigate({
                search: (s) => ({ ...s, program: v === "_all_" ? null : v }),
              })
            }
            value={search.program ?? "_all_"}
          >
            <SelectTrigger className="w-full" id="analytics-program">
              <SelectValue placeholder="All programs" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all_">All programs</SelectItem>
              {programs.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.courseId} {p.courseName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <SectionHeading note="Stocks. The date range does not apply here.">
        As of now
      </SectionHeading>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Figure
          hint={slotsHint(h)}
          label="Published team slots"
          scope="program"
          value={h.publishedTeamSlots}
        />
        <Figure
          hint={
            h.oldestSubmittedAt
              ? `Oldest waiting ${daysSince(h.oldestSubmittedAt)}`
              : "Nothing waiting"
          }
          label="Submitted, awaiting review"
          scope="program"
          value={h.submittedAwaiting}
        />
        <Figure
          hint="Every live status, no mentor address on file"
          label="Student proposed, no mentor"
          scope="program"
          value={h.studentProposedWithoutMentor}
        />
        <Figure
          hint={`${h.publishedWithoutMentor} without`}
          label="Published with a mentor"
          scope="program"
          value={h.publishedWithMentor}
        />
        <Figure
          hint={`${h.mentors.offered} mentors, ${h.mentors.assigned} assigned, ${h.mentors.unassignedCapacity} unassigned. ${h.mentors.assignedWithoutCapacity} assigned to an address with no mentor account, so against no capacity.`}
          label="Mentor team capacity offered"
          scope="global"
          value={h.mentors.capacity}
        />
        <Figure
          hint={
            h.oldestOverdueAt
              ? `Oldest overdue ${daysSince(h.oldestOverdueAt)}`
              : "None overdue"
          }
          label="Overdue inventory items"
          scope="global"
          value={h.overdueItems}
        />
        <Figure
          hint={
            h.oldestPendingRequestAt
              ? `Oldest request ${daysSince(h.oldestPendingRequestAt)}`
              : "Nothing pending"
          }
          label="Pending request lines"
          scope="global"
          value={h.pendingLines}
        />
        <Figure
          hint="The number the admin hub shows"
          label="Requests with a pending line"
          scope="global"
          value={h.requestsWithPending}
        />
        <Figure
          hint="No bookmark since publication"
          label="Published, unbookmarked"
          scope="program"
          value={h.publishedWithoutBookmarks}
        />
      </div>

      <SectionHeading note="per program">Bookmarks per project</SectionHeading>
      <p className="text-muted-foreground mt-1 text-sm">
        Every published project, counting the bookmarks made since it was
        published; a project in two programs is listed under each.
      </p>
      <div className="mt-2">
        <AdminDataTable
          caption="Bookmarks per published project"
          data={view.bookmarksByProject}
          emptyMessage="No published projects."
          getRowId={(row) => row.id}
          {...tableProps}
        />
      </div>

      <SectionHeading note="per program">Bookmarks by category</SectionHeading>
      <p className="text-muted-foreground mt-1 text-sm">
        Published projects only, with the same count; a project in two
        categories counts in full in both, so the columns add up to more than
        the table above.
      </p>
      <div className="mt-2">
        <CategoryDemandTable rows={view.bookmarksByCategory} />
      </div>

      <SectionHeading
        note={`${view.flows.range.from} to ${view.flows.range.to}, against ${view.flows.range.previousFrom} to ${view.flows.range.previousTo}`}
      >
        In the date range
      </SectionHeading>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <FlowCard
          flow={view.flows.submitted}
          label="Projects submitted"
          scope="program"
        />
        <FlowCard
          flow={view.flows.published}
          label="Projects published"
          scope="program"
        />
        <FlowCard
          flow={view.flows.inventoryRequests}
          label="Inventory requests"
          scope="global"
        />
        {view.flows.newUsers && (
          <FlowCard
            flow={view.flows.newUsers}
            label="New users"
            scope="global"
          />
        )}
      </div>

      <SectionHeading note="Stocks. The date range does not apply here.">
        Breakdowns, as of now
      </SectionHeading>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Breakdown
          labels={PROJECT_STATUS_LABEL}
          rows={view.breakdowns.projectsByStatus}
          scope="program"
          title="Projects by status"
        />
        {view.breakdowns.projectsByProgram && (
          <Breakdown
            labels={Object.fromEntries(
              view.breakdowns.projectsByProgram.map((b) => [b.key, b.label])
            )}
            rows={view.breakdowns.projectsByProgram}
            scope="global"
            title="Projects by program"
          />
        )}
        <Breakdown
          rows={view.breakdowns.projectsByCategory}
          scope="program"
          title="Projects by category"
        />
        <Breakdown
          labels={ITEM_STATUS_LABEL}
          rows={view.breakdowns.itemsByStatus}
          scope="global"
          title="Inventory items by status"
        />
        <Breakdown
          rows={view.breakdowns.itemsByCategory}
          scope="global"
          title="Inventory items by category"
        />
        <Breakdown
          labels={LINE_STATUS_LABEL}
          rows={view.breakdowns.requestLinesByStatus}
          scope="global"
          title="Request lines by status"
        />
        {view.breakdowns.usersByRole && (
          <Breakdown
            labels={ROLE_LABEL}
            rows={view.breakdowns.usersByRole}
            scope="global"
            title="Users by role"
          />
        )}
      </div>
    </div>
  );
}
