import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
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
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import type { Bucket, Flow } from "#/server/_internal/analytics";
import { getAnalytics } from "#/server/analytics";
import { listPrograms } from "#/server/programs";

const DAY_MS = 86_400_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function isoDay(offset: number): string {
  return new Date(Date.now() + offset * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The two page controls live in the URL so a filtered view is a link staff
 * can share. Defaults: the last thirty days, every program.
 */
const searchSchema = z.object({
  from: z.string().regex(DATE).optional(),
  to: z.string().regex(DATE).optional(),
  program: z.string().uuid().nullable().catch(null).default(null),
});

type Search = z.infer<typeof searchSchema>;

function resolveRange(search: Search) {
  const to = search.to ?? isoDay(0);
  const from = search.from ?? isoDay(-30);
  return from <= to ? { from, to } : { from: to, to: from };
}

export const Route = createFileRoute("/_authed/admin/analytics")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Analytics") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
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

const PROJECT_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  submitted: "Submitted",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};

const ITEM_STATUS_LABEL: Record<string, string> = {
  available: "Available",
  requested: "Requested",
  reserved: "Reserved",
  checked_out: "Checked out",
  maintenance: "Maintenance",
  retired: "Retired",
};

const LINE_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
  returned: "Returned",
};

const ROLE_LABEL: Record<string, string> = {
  admin: "Admin",
  instructor: "Instructor",
  user: "User",
};

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
      <p className="flex items-baseline justify-between gap-2 text-muted-foreground text-sm">
        <span>{label}</span>
        {/* Named on every card so the controls are not read as doing
            something they are not: a global figure ignores the program. */}
        <span className="text-xs">
          {scope === "program" ? "per program" : "global"}
        </span>
      </p>
      <p className="mt-1 font-semibold text-2xl tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>}
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
        <p className="mt-2 text-muted-foreground text-sm">Nothing yet.</p>
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
      <h2 className="font-medium text-muted-foreground text-xs uppercase tracking-wide">
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
  const slotsHint = (() => {
    if (h.expectedTeams === null) {
      return "Expected teams not set on the program";
    }
    const gap = h.expectedTeams - h.publishedTeamSlots;
    if (gap > 0) {
      return `${h.expectedTeams} expected, ${gap} short`;
    }
    return `${h.expectedTeams} expected, covered`;
  })();

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
      <h1 className="mt-2 font-semibold text-2xl">Analytics</h1>
      <p className="mt-1 text-muted-foreground text-sm">
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
          hint={slotsHint}
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
          hint="Student-proposed, no mentor named"
          label="Needing a mentor"
          scope="program"
          value={h.seekingMentor}
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
          hint={`${h.requestsWithPending} ${h.requestsWithPending === 1 ? "request" : "requests"} with a pending line${h.oldestPendingRequestAt ? `, oldest ${daysSince(h.oldestPendingRequestAt)}` : ""}`}
          label="Pending request lines"
          scope="global"
          value={h.pendingLines}
        />
        <Figure
          hint="No bookmark since publication"
          label="Published, unbookmarked"
          scope="program"
          value={h.publishedWithoutBookmarks}
        />
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
