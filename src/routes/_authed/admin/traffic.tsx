import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import {
  type AdminColumn,
  AdminDataTable,
  defineAdminColumns,
} from "#/components/admin-data-table";
import { TrafficChart } from "#/components/traffic-chart";
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
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
import { resolveRange } from "#/lib/report-range";
import type { SortState } from "#/lib/table-state";
import { useAdminTable } from "#/lib/use-admin-table";
import { isStaff } from "#/lib/viewer";
import { getTraffic } from "#/server/traffic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The date range and the per-project table's sort live in the URL, so a view
 * is a link staff can share. Defaults: the last thirty days, most viewed
 * first. The other tables sort in place and forget it on reload.
 */
const searchSchema = z.object({
  from: z.string().regex(DATE).optional().catch(undefined),
  to: z.string().regex(DATE).optional().catch(undefined),
  sort: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  cols: z.string().optional(),
});

type TrafficView = Awaited<ReturnType<typeof getTraffic>>;
type ProjectRow = TrafficView["projects"][number];

export const Route = createFileRoute("/_authed/admin/traffic")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Traffic") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!isStaff(session.user)) {
      throw redirect({ to: "/" });
    }
  },
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to }),
  loader: async ({ deps }) => {
    const range = resolveRange(deps);
    const view = await getTraffic({ data: range });
    return { view, range };
  },
  component: TrafficPage,
});

const COUNT = new Intl.NumberFormat("en-US");
const ONE_PLACE = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
const PERCENT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
  style: "percent",
});

function change(current: number, previous: number, format: Intl.NumberFormat) {
  const delta = current - previous;
  if (delta === 0) {
    return "no change";
  }
  return `${delta > 0 ? "up" : "down"} ${format.format(Math.abs(delta))}`;
}

function Figure({
  hint,
  label,
  note,
  value,
}: {
  hint: string;
  label: string;
  note?: string;
  value: string;
}) {
  return (
    <Card className="p-4">
      <p className="text-muted-foreground text-sm">{label}</p>
      <p className="mt-1 font-semibold text-2xl tabular-nums">{value}</p>
      <p className="mt-0.5 text-muted-foreground text-xs">{hint}</p>
      {note && <p className="mt-2 text-muted-foreground text-xs">{note}</p>}
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

/** A pathname, or the project's title when the page is one. */
function PageLabel({
  pathname,
  title,
}: {
  pathname: string;
  title: string | null;
}) {
  if (!title) {
    return <span className="break-all font-mono text-xs">{pathname}</span>;
  }
  return (
    <span>
      {title}
      <span className="block break-all font-mono text-muted-foreground text-xs">
        {pathname}
      </span>
    </span>
  );
}

const PROJECT_COLUMNS = defineAdminColumns<ProjectRow>()([
  {
    accessorFn: (row) => row.title,
    cardHeader: true,
    cell: ({ row }) => (
      <Link
        className="text-brand-dark underline"
        params={{ projectId: row.original.id }}
        to="/projects/$projectId"
      >
        {row.original.title}
      </Link>
    ),
    enableHiding: false,
    header: "Project",
    id: "title",
  },
  {
    accessorFn: (row) => row.views,
    cell: ({ row }) => COUNT.format(row.original.views),
    enableHiding: false,
    header: "Page views",
    id: "views",
    sortFn: "basic",
  },
  {
    accessorFn: (row) => row.visits,
    cell: ({ row }) => COUNT.format(row.original.visits),
    enableHiding: false,
    header: "Visits",
    id: "visits",
    sortFn: "basic",
  },
]);

const PROJECTS_DEFAULT_SORT: SortState = { desc: true, id: "views" };

interface KeyedRow {
  key: string;
  label: string;
  pathname?: string;
  title?: string | null;
  views?: number;
  visits: number;
}

function countColumn(id: "views" | "visits", header: string) {
  return {
    accessorFn: (row: KeyedRow) => row[id] ?? 0,
    cell: ({ row }: { row: { original: KeyedRow } }) =>
      COUNT.format(row.original[id] ?? 0),
    enableHiding: false,
    header,
    id,
    sortFn: "basic" as const,
  };
}

const LABEL_COLUMN = {
  accessorFn: (row: KeyedRow) => row.label,
  cardHeader: true,
  cell: ({ row }: { row: { original: KeyedRow } }) =>
    row.original.pathname === undefined ? (
      row.original.label
    ) : (
      <PageLabel
        pathname={row.original.pathname}
        title={row.original.title ?? null}
      />
    ),
  enableHiding: false,
  id: "label",
};

/**
 * A table that sorts in place: every table on the page but the per-project
 * one, whose sort is in the URL. Nothing to hide, so no Columns menu.
 */
function LocalTable({
  caption,
  columns,
  emptyMessage,
  rows,
  storageKey,
}: {
  caption: string;
  columns: AdminColumn<KeyedRow>[];
  emptyMessage: string;
  rows: KeyedRow[];
  storageKey: string;
}) {
  const defaultSort: SortState = { desc: true, id: columns[1]?.id ?? "label" };
  const [sort, setSort] = useState(defaultSort);
  return (
    <AdminDataTable
      caption={caption}
      columns={columns}
      data={rows}
      defaultSort={defaultSort}
      emptyMessage={emptyMessage}
      getRowId={(row) => row.key}
      hidden={[]}
      onHiddenChange={() => undefined}
      onSortChange={setSort}
      sort={sort}
      storageKey={storageKey}
    />
  );
}

function tableColumns(
  labelHeader: string,
  counts: [id: "views" | "visits", header: string][]
): AdminColumn<KeyedRow>[] {
  return [
    { ...LABEL_COLUMN, header: labelHeader },
    ...counts.map(([id, header]) => countColumn(id, header)),
  ] as AdminColumn<KeyedRow>[];
}

const PAGE_COLUMNS = tableColumns("Page", [
  ["views", "Page views"],
  ["visits", "Visits"],
]);
const ENTRY_COLUMNS = tableColumns("Entry page", [["visits", "Visits"]]);

const DEVICE_LABEL: Record<string, string> = {
  desktop: "Desktop",
  mobile: "Mobile",
  tablet: "Tablet",
};

const COUNTRY = new Intl.DisplayNames(["en"], { type: "region" });

function countryName(code: string): string {
  try {
    return COUNTRY.of(code) ?? code;
  } catch {
    return code;
  }
}

function buckets(
  rows: { key: string | null; visits: number }[],
  label: (key: string) => string,
  unknown: string
): KeyedRow[] {
  return rows.map(({ key, visits }) => ({
    key: key ?? "",
    label: key === null ? unknown : label(key),
    visits,
  }));
}

function TrafficPage() {
  const { view, range } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const h = view.headline;
  const { tableProps } = useAdminTable({
    columns: PROJECT_COLUMNS,
    defaultSort: PROJECTS_DEFAULT_SORT,
    navigate,
    search,
    storageKey: "traffic-projects",
  });

  const rate = (value: number | null) =>
    value === null ? "-" : PERCENT.format(value);

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
            <BreadcrumbPage>Traffic</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <h1 className="mt-2 font-semibold text-2xl">Traffic</h1>
      <p className="mt-1 text-muted-foreground text-sm">
        What readers do on the public pages: the home page, the project and
        inventory listings and pages, and the privacy page. Counted without
        cookies, so a visitor is a browser on one day, never an account. Pages
        that require signing in are not counted, and nothing from before the
        traffic writer shipped is here.
      </p>

      <Card className="mt-4 grid gap-3 bg-transparent p-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="traffic-from">From</Label>
          <Input
            id="traffic-from"
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
          <Label htmlFor="traffic-to">To</Label>
          <Input
            id="traffic-to"
            onChange={(e) =>
              navigate({
                search: (s) => ({ ...s, to: e.target.value || undefined }),
              })
            }
            type="date"
            value={range.to}
          />
        </div>
      </Card>

      <SectionHeading
        note={`${view.range.from} to ${view.range.to}, against ${view.range.previousFrom} to ${view.range.previousTo}`}
      >
        In the date range
      </SectionHeading>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Figure
          hint={`${COUNT.format(h.views.previous)} in the previous period, ${change(h.views.current, h.views.previous, COUNT)}`}
          label="Page views"
          value={COUNT.format(h.views.current)}
        />
        <Figure
          hint={`${COUNT.format(h.visits.previous)} in the previous period, ${change(h.visits.current, h.visits.previous, COUNT)}`}
          label="Visits"
          note="A visit spanning midnight counts as two."
          value={COUNT.format(h.visits.current)}
        />
        <Figure
          hint={`${ONE_PLACE.format(h.dailyVisitors.previous)} in the previous period, ${change(h.dailyVisitors.current, h.dailyVisitors.previous, ONE_PLACE)}`}
          label="Average daily visitors"
          note="Visitors are counted per day and cannot be added up across days: a returning reader is new each day. Students on campus share a network address, so they undercount."
          value={ONE_PLACE.format(h.dailyVisitors.current)}
        />
        <Figure
          hint={`${rate(h.bounceRate.previous)} in the previous period`}
          label="Bounce rate"
          note="Visits with one event. Landing and then filtering is not a bounce."
          value={rate(h.bounceRate.current)}
        />
      </div>

      <SectionHeading>Per day</SectionHeading>
      <Card className="mt-2 p-4">
        <TrafficChart daily={view.daily} />
      </Card>

      <SectionHeading note="Every published project, including those nobody opened">
        Views per project
      </SectionHeading>
      <div className="mt-2">
        <AdminDataTable
          caption="Page views and visits per published project"
          data={view.projects}
          emptyMessage="No published projects."
          getRowId={(row) => row.id}
          {...tableProps}
        />
      </div>

      <SectionHeading>Pages</SectionHeading>
      <div className="mt-2">
        <LocalTable
          caption="Page views and visits per page"
          columns={PAGE_COLUMNS}
          emptyMessage="No page views in this range."
          rows={view.pages.map((page) => ({
            key: page.pathname,
            label: page.title ?? page.pathname,
            pathname: page.pathname,
            title: page.title,
            views: page.views,
            visits: page.visits,
          }))}
          storageKey="traffic-pages"
        />
      </div>

      <SectionHeading note="The first page a visit viewed">
        Entry pages
      </SectionHeading>
      <div className="mt-2">
        <LocalTable
          caption="Visits per entry page"
          columns={ENTRY_COLUMNS}
          emptyMessage="No visits in this range."
          rows={view.breakdowns.entryPages.map((page) => ({
            key: page.pathname,
            label: page.title ?? page.pathname,
            pathname: page.pathname,
            title: page.title,
            visits: page.visits,
          }))}
          storageKey="traffic-entries"
        />
      </div>

      <SectionHeading note="The site a visit's entry page was reached from">
        Referring sites
      </SectionHeading>
      <div className="mt-2">
        <LocalTable
          caption="Visits per referring site"
          columns={tableColumns("Site", [["visits", "Visits"]])}
          emptyMessage="No visits in this range."
          rows={buckets(
            view.breakdowns.referrers,
            (host) => host,
            "Direct, or not sent"
          )}
          storageKey="traffic-referrers"
        />
      </div>

      <SectionHeading>Where visits come from</SectionHeading>
      <div className="mt-2 grid gap-6">
        <LocalTable
          caption="Visits per country"
          columns={tableColumns("Country", [["visits", "Visits"]])}
          emptyMessage="No visits in this range."
          rows={buckets(view.breakdowns.countries, countryName, "Unknown")}
          storageKey="traffic-countries"
        />
        <div>
          <LocalTable
            caption="Visits per device class"
            columns={tableColumns("Device", [["visits", "Visits"]])}
            emptyMessage="No visits in this range."
            rows={buckets(
              view.breakdowns.devices,
              (device) => DEVICE_LABEL[device] ?? device,
              "Unknown"
            )}
            storageKey="traffic-devices"
          />
          <p className="mt-2 text-muted-foreground text-xs">
            Tablets undercount: an iPad reads as a Mac.
          </p>
        </div>
        <LocalTable
          caption="Visits per browser"
          columns={tableColumns("Browser", [["visits", "Visits"]])}
          emptyMessage="No visits in this range."
          rows={buckets(view.breakdowns.browsers, (b) => b, "Unknown")}
          storageKey="traffic-browsers"
        />
      </div>

      <SectionHeading note="Share of visits to each listing that set the filter at least once">
        Filter use
      </SectionHeading>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        {view.filterUse.map((use) => (
          <Card className="p-4" key={use.listing}>
            <p className="flex items-baseline justify-between gap-2 text-sm">
              <span className="font-medium">{use.listing}</span>
              <span className="text-muted-foreground text-xs">
                {COUNT.format(use.visits)} visits
              </span>
            </p>
            <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
              {use.filters.map((filter) => (
                <div className="contents" key={filter.key}>
                  <dt className="text-muted-foreground">{filter.label}</dt>
                  <dd className="text-right tabular-nums">
                    {use.visits === 0
                      ? "-"
                      : PERCENT.format(filter.visits / use.visits)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    </div>
  );
}
