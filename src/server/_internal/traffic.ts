import { type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import { requireUser } from "#/lib/_internal/auth-guards";
import { ROLLUP_SETTLE_MS } from "#/lib/_internal/traffic-timing";
import { comparisonPeriods, localDay, shiftDay } from "#/lib/day-range";
import {
  TRAFFIC_FILTERS,
  TRAFFIC_LISTINGS,
  type TrafficFilter,
  type TrafficListing,
} from "#/lib/traffic-filters";
import { assertStaff, type Viewer } from "#/lib/viewer";
import type { TrafficInput } from "../traffic";

/**
 * The reports on `/admin/traffic` (#592), read through the app pool: they are
 * a page render, and ADR-0034 keeps the traffic writer's pool for writes.
 *
 * A visit is one visitor hash's events with no gap over 30 minutes, ended by
 * the office's local midnight whatever else happens (ADR-0048). The reports
 * never read events directly: they read visits, from `traffic_visits` for
 * closed days and from `visitRowsQuery` for the rest (ADR-0050). Deriving a
 * 90-day range of visits on every load took over 500 ms at a million events,
 * which is what the rollup is for; the timings are on #592.
 *
 * Each report is its own exported query builder so `scripts/explain-traffic.ts`
 * times exactly the SQL this page runs.
 */

const GAP = sql.raw("interval '30 minutes'");

/**
 * How long after local midnight a day counts as closed. An event is stamped
 * before its insert commits, so one handled at 23:59:59 lands a moment after
 * midnight; `traffic-timing.ts` bounds how long that moment can be.
 */
const SETTLE_MS = ROLLUP_SETTLE_MS;

/** The first day not yet closed at `now`: every earlier day is final. */
export function openFrom(now: Date): string {
  return localDay(new Date(now.getTime() - SETTLE_MS));
}

const LISTINGS = sql.join(
  TRAFFIC_LISTINGS.map((listing) => sql`${listing}`),
  sql`, `
);

/** Whether a stored search sets `filter`, as a SQL boolean over `search`. */
function filterSet(filter: TrafficFilter): SQL {
  const value = sql`search -> ${filter.key}`;
  switch (filter.test.kind) {
    case "text":
      return sql`coalesce(search ->> ${filter.key}, '') <> ''`;
    case "list":
      return sql`jsonb_typeof(${value}) = 'array' AND jsonb_array_length(${value}) > 0`;
    case "choice":
      return sql`${value} IS NOT NULL AND ${value} <> 'null'::jsonb`;
    case "switch":
      return sql`${value} IS NOT NULL AND ${value} <> ${JSON.stringify(filter.test.default)}::jsonb`;
    case "equals":
      return sql`search ->> ${filter.key} = ${filter.test.value}`;
    default:
      return sql`false`;
  }
}

/** How a filter is named in `traffic_visits.filters`. */
export function filterTag(listing: TrafficListing, key: string): string {
  return `${listing}:${key}`;
}

const VISIT_COLUMNS = sql.raw(
  "day, started_at, events, views, first_of_day, entry_path, entry_referrer, country, browser, device, pages, page_views, listings, filters"
);

/** The first value of `column` in a visit, by time then id, over views only if asked. */
function firstOf(column: string, viewsOnly = false): SQL {
  const filter = viewsOnly ? " FILTER (WHERE kind = 'view')" : "";
  return sql.raw(`(array_agg(${column} ORDER BY occurred_at, id)${filter})[1]`);
}

/**
 * The visits of the days from `from` to `to`, derived from their events, in
 * `traffic_visits`'s columns. Used to fill the rollup and for the days not
 * yet closed.
 *
 * Partitioned by `(day, visitor_hash)`: a visit ends at local midnight by
 * definition, so none crosses a partition, and that is the order of
 * `traffic_events_visit_idx`. `ROWS` frames, so two events sharing a
 * timestamp are still two steps. Every "first" is ordered by time and then
 * by id, so a tie resolves the same way on every run.
 */
export function visitRowsQuery(from: string, to: string): SQL {
  const flags = TRAFFIC_LISTINGS.flatMap((listing) =>
    TRAFFIC_FILTERS[listing].map(
      (filter) =>
        sql`CASE WHEN bool_or(${filterSet(filter)}) FILTER (WHERE pathname = ${listing}) THEN ${filterTag(listing, filter.key)} END`
    )
  );
  return sql`
    WITH placed AS (
      SELECT e.*, sum(e.starts) OVER w AS visit
      FROM (
        SELECT day, visitor_hash, occurred_at, id, kind, pathname,
          referrer_host, country, browser, device,
          CASE WHEN pathname IN (${LISTINGS}) THEN search END AS search,
          CASE WHEN occurred_at - lag(occurred_at) OVER w <= ${GAP}
            THEN 0 ELSE 1 END AS starts
        FROM traffic_events
        WHERE day >= ${from}::date AND day <= ${to}::date
        WINDOW w AS (PARTITION BY day, visitor_hash ORDER BY occurred_at, id
                     ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
      ) e
      WINDOW w AS (PARTITION BY e.day, e.visitor_hash ORDER BY e.occurred_at, e.id
                   ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
    ),
    page_counts AS (
      SELECT day, visitor_hash, visit,
        array_agg(pathname ORDER BY pathname) AS pages,
        array_agg(n ORDER BY pathname) AS page_views
      FROM (
        SELECT day, visitor_hash, visit, pathname, count(*)::int AS n
        FROM placed
        WHERE kind = 'view'
        GROUP BY day, visitor_hash, visit, pathname
      ) per_page
      GROUP BY day, visitor_hash, visit
    ),
    visits AS (
      SELECT day, visitor_hash, visit,
        min(occurred_at) AS started_at,
        count(*)::int AS events,
        count(*) FILTER (WHERE kind = 'view')::int AS views,
        visit = 1 AS first_of_day,
        ${firstOf("pathname", true)} AS entry_path,
        ${firstOf("referrer_host", true)} AS entry_referrer,
        ${firstOf("country")} AS country,
        ${firstOf("browser")} AS browser,
        ${firstOf("device")} AS device,
        coalesce(array_agg(DISTINCT pathname) FILTER (WHERE pathname IN (${LISTINGS})), '{}') AS listings,
        array_remove(ARRAY[${sql.join(flags, sql`, `)}]::text[], NULL) AS filters
      FROM placed
      GROUP BY day, visitor_hash, visit
    )
    SELECT v.day, v.started_at, v.events, v.views, v.first_of_day,
      v.entry_path, v.entry_referrer, v.country, v.browser, v.device,
      coalesce(p.pages, '{}') AS pages,
      coalesce(p.page_views, '{}') AS page_views,
      v.listings, v.filters
    FROM visits v
    LEFT JOIN page_counts p USING (day, visitor_hash, visit)`;
}

/**
 * Fills `traffic_visits` for every closed day after the last one it holds.
 * Runs on each load of the page, so it usually rolls up one day or none.
 *
 * Under a transaction-scoped advisory lock, and the last day is read after
 * the lock is held, so two staff loading the page at once roll each day up
 * once: the second finds the first's rows and has nothing to do.
 */
export async function rollUpTrafficVisits(now: Date): Promise<void> {
  const open = openFrom(now);
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext('traffic_visits'))`
    );
    const [{ from }] = (
      await tx.execute<{ from: string | null }>(sql`
        SELECT min(day)::text AS from FROM traffic_events
        WHERE day > coalesce((SELECT max(day) FROM traffic_visits), '-infinity'::date)
          AND day < ${open}::date`)
    ).rows;
    if (!from) {
      return;
    }
    await tx.execute(
      sql`INSERT INTO traffic_visits (${VISIT_COLUMNS}) ${visitRowsQuery(from, shiftDay(open, -1))}`
    );
  });
}

/**
 * The visits of `from` to `to`: the rollup's rows for closed days, derived
 * rows for the rest. Assumes `rollUpTrafficVisits` ran for the same `now`.
 */
export function visitsInRange(from: string, to: string, now: Date): SQL {
  const open = openFrom(now);
  const rolledTo = to < open ? to : shiftDay(open, -1);
  const liveFrom = from > open ? from : open;
  const parts: SQL[] = [];
  if (from <= rolledTo) {
    parts.push(
      sql`SELECT ${VISIT_COLUMNS} FROM traffic_visits WHERE day >= ${from}::date AND day <= ${rolledTo}::date`
    );
  }
  if (liveFrom <= to) {
    parts.push(
      sql`SELECT ${VISIT_COLUMNS} FROM (${visitRowsQuery(liveFrom, to)}) live`
    );
  }
  if (parts.length === 0) {
    return sql`SELECT ${VISIT_COLUMNS} FROM traffic_visits WHERE false`;
  }
  return sql.join(parts, sql` UNION ALL `);
}

/** Per local day: page views, visits, bounces and distinct visitors. */
export function dailyQuery(visits: SQL): SQL {
  return sql`
    SELECT day::text AS day,
      sum(views)::int AS views,
      count(*)::int AS visits,
      count(*) FILTER (WHERE events = 1)::int AS bounces,
      count(*) FILTER (WHERE first_of_day)::int AS visitors
    FROM (${visits}) v
    GROUP BY day
    ORDER BY day`;
}

/** Page views and visits per pathname. A visit counts once per page. */
export function pagesQuery(visits: SQL): SQL {
  return sql`
    SELECT page AS pathname, sum(n)::int AS views, count(*)::int AS visits
    FROM (${visits}) v, unnest(v.pages, v.page_views) AS u(page, n)
    GROUP BY page`;
}

/**
 * Visits by entry page and by the entry's referring host, counting visits
 * that viewed a page; and every visit by country, device class and browser.
 */
export function entriesQuery(visits: SQL): SQL {
  return sql`
    SELECT
      CASE
        WHEN GROUPING(entry_path) = 0 THEN 'page'
        WHEN GROUPING(entry_referrer) = 0 THEN 'referrer'
        WHEN GROUPING(country) = 0 THEN 'country'
        WHEN GROUPING(device) = 0 THEN 'device'
        ELSE 'browser'
      END AS dimension,
      CASE
        WHEN GROUPING(entry_path) = 0 THEN entry_path
        WHEN GROUPING(entry_referrer) = 0 THEN entry_referrer
        WHEN GROUPING(country) = 0 THEN country
        WHEN GROUPING(device) = 0 THEN device::text
        ELSE browser
      END AS key,
      CASE
        WHEN GROUPING(entry_path) = 0 OR GROUPING(entry_referrer) = 0
          THEN count(*) FILTER (WHERE entry_path IS NOT NULL)
        ELSE count(*)
      END::int AS visits
    FROM (${visits}) v
    GROUP BY GROUPING SETS ((entry_path), (entry_referrer), (country), (device), (browser))`;
}

/**
 * Visits per listing reached, and per listing filter set. One pass, and
 * only over visits that reached a listing, since no other visit can have
 * set a filter.
 */
export function filterUseQuery(visits: SQL): SQL {
  return sql`
    SELECT t.kind, t.tag, count(*)::int AS visits
    FROM (${visits}) v,
      LATERAL (
        SELECT 'listing' AS kind, unnest(v.listings) AS tag
        UNION ALL
        SELECT 'filter' AS kind, unnest(v.filters) AS tag
      ) t
    WHERE cardinality(v.listings) > 0
    GROUP BY t.kind, t.tag`;
}

export interface TrafficFigure {
  current: number;
  previous: number;
}

/** A share, or null when there was nothing to take a share of. */
export interface TrafficRate {
  current: number | null;
  previous: number | null;
}

export interface TrafficBucket {
  key: string | null;
  visits: number;
}

export interface TrafficPage {
  pathname: string;
  /** The project's title, for a `/projects/<id>` page whose project exists. */
  title: string | null;
  views: number;
  visits: number;
}

export interface TrafficFilterUse {
  filters: { key: string; label: string; visits: number }[];
  listing: TrafficListing;
  visits: number;
}

export interface TrafficView {
  breakdowns: {
    browsers: TrafficBucket[];
    countries: TrafficBucket[];
    devices: TrafficBucket[];
    entryPages: { pathname: string; title: string | null; visits: number }[];
    referrers: TrafficBucket[];
  };
  daily: { day: string; views: number; visits: number }[];
  filterUse: TrafficFilterUse[];
  headline: {
    bounceRate: TrafficRate;
    /** Distinct visitor hashes per local day, averaged over every day. */
    dailyVisitors: TrafficFigure;
    views: TrafficFigure;
    visits: TrafficFigure;
  };
  pages: TrafficPage[];
  projects: { id: string; title: string; views: number; visits: number }[];
  range: { from: string; previousFrom: string; previousTo: string; to: string };
}

interface DailyRow {
  bounces: number;
  day: string;
  views: number;
  visitors: number;
  visits: number;
}

function totals(daily: DailyRow[], days: number) {
  const sum = (key: keyof Omit<DailyRow, "day">) =>
    daily.reduce((n, row) => n + row[key], 0);
  const visits = sum("visits");
  return {
    bounceRate: visits === 0 ? null : sum("bounces") / visits,
    dailyVisitors: sum("visitors") / days,
    views: sum("views"),
    visits,
  };
}

/** Every day from `from` to `to`, zero-filled where nothing happened. */
function everyDay(from: string, to: string, daily: DailyRow[]) {
  const byDay = new Map(daily.map((row) => [row.day, row]));
  const days: TrafficView["daily"] = [];
  for (let day = from; day <= to; day = shiftDay(day, 1)) {
    const row = byDay.get(day);
    days.push({ day, views: row?.views ?? 0, visits: row?.visits ?? 0 });
  }
  return days;
}

async function run<T>(query: SQL): Promise<T[]> {
  return (await db.execute(query)).rows as T[];
}

const byVisits = <T extends { visits: number }>(a: T, b: T) =>
  b.visits - a.visits;

export async function getTrafficAs(
  viewer: NonNullable<Viewer>,
  input: TrafficInput,
  now: Date = new Date()
): Promise<TrafficView> {
  assertStaff(viewer);
  await rollUpTrafficVisits(now);
  const p = comparisonPeriods(input.from, input.to);
  const current = visitsInRange(p.range.from, p.range.to, now);
  const previous = visitsInRange(p.range.previousFrom, p.range.previousTo, now);

  const [daily, previousDaily, pages, entries, filterRows, live] =
    await Promise.all([
      run<DailyRow>(dailyQuery(current)),
      run<DailyRow>(dailyQuery(previous)),
      run<Omit<TrafficPage, "title">>(pagesQuery(current)),
      run<{ dimension: string; key: string | null; visits: number }>(
        entriesQuery(current)
      ),
      run<{ kind: string; tag: string; visits: number }>(
        filterUseQuery(current)
      ),
      run<{ id: string; published: boolean; title: string }>(
        sql`SELECT id::text AS id, title, status = 'published' AS published
            FROM projects WHERE deleted_at IS NULL`
      ),
    ]);

  const title = new Map(live.map((t) => [`/projects/${t.id}`, t.title]));
  const byPath = new Map(pages.map((page) => [page.pathname, page]));
  const titled = (pathname: string) => title.get(pathname) ?? null;
  const bucket = (dimension: string) =>
    entries
      .filter((e) => e.dimension === dimension && e.visits > 0)
      .map(({ key, visits }) => ({ key, visits }))
      .sort(byVisits);
  const tagged = new Map(
    filterRows.map((r) => [`${r.kind} ${r.tag}`, r.visits])
  );
  const thisPeriod = totals(daily, p.days);
  const lastPeriod = totals(previousDaily, p.days);

  return {
    breakdowns: {
      browsers: bucket("browser"),
      countries: bucket("country"),
      devices: bucket("device"),
      entryPages: bucket("page").flatMap(({ key, visits }) =>
        key === null ? [] : [{ pathname: key, title: titled(key), visits }]
      ),
      referrers: bucket("referrer"),
    },
    daily: everyDay(input.from, input.to, daily),
    filterUse: TRAFFIC_LISTINGS.map((listing) => ({
      listing,
      visits: tagged.get(`listing ${listing}`) ?? 0,
      filters: TRAFFIC_FILTERS[listing].map((filter) => ({
        key: filter.key,
        label: filter.label,
        visits: tagged.get(`filter ${filterTag(listing, filter.key)}`) ?? 0,
      })),
    })),
    headline: {
      bounceRate: {
        current: thisPeriod.bounceRate,
        previous: lastPeriod.bounceRate,
      },
      dailyVisitors: {
        current: thisPeriod.dailyVisitors,
        previous: lastPeriod.dailyVisitors,
      },
      views: { current: thisPeriod.views, previous: lastPeriod.views },
      visits: { current: thisPeriod.visits, previous: lastPeriod.visits },
    },
    pages: pages
      .map((page) => ({ ...page, title: titled(page.pathname) }))
      .sort((a, b) => b.views - a.views),
    // Every published, live project, zeros included: a project nobody opened
    // is listed rather than missing. Joined on the pathname, since events
    // carry no project id.
    projects: live
      .filter((project) => project.published)
      .map(({ id, title: name }) => {
        const page = byPath.get(`/projects/${id}`);
        return {
          id,
          title: name,
          views: page?.views ?? 0,
          visits: page?.visits ?? 0,
        };
      })
      .sort((a, b) => b.views - a.views || a.title.localeCompare(b.title)),
    range: p.range,
  };
}

export async function getTrafficForCurrentUser(
  input: TrafficInput
): Promise<TrafficView> {
  const viewer = await requireUser();
  return getTrafficAs(viewer, input);
}
