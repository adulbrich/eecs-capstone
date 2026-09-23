import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import type { TrafficSearch } from "#/db/schema";
import { projects, trafficEvents, trafficVisits } from "#/db/schema";
import { dayStart } from "#/lib/day-range";
import { getTrafficAs, rollUpTrafficVisits } from "#/server/_internal/traffic";

/**
 * The definitions #592 fixes, pinned against Postgres: a visit, a bounce,
 * an entry page, average daily visitors, views per project, filter use, and
 * the rollup that serves closed days (ADR-0050). Every figure is read
 * through `getTrafficAs`, the seam the page calls.
 */

const STAFF = { id: "staff-viewer", role: "instructor" } as const;
const DAY = "2026-05-12";
const NEXT_DAY = "2026-05-13";
/** Long after every fixture day, so each is closed and rolled up. */
const LATER = new Date("2026-06-01T12:00:00Z");

/** An instant at `hh:mm` office time on `day`. */
function at(day: string, time: string): Date {
  const [h, m] = time.split(":").map(Number);
  return new Date(dayStart(day).getTime() + (h * 60 + m) * 60_000);
}

interface Event {
  at: Date;
  hash: string;
  kind?: "view" | "search";
  pathname?: string;
  referrer?: string | null;
  search?: TrafficSearch | null;
}

async function events(...rows: Event[]) {
  await db.insert(trafficEvents).values(
    rows.map((row) => ({
      occurredAt: row.at,
      kind: row.kind ?? "view",
      visitorHash: row.hash,
      pathname: row.pathname ?? "/",
      referrerHost: row.referrer ?? null,
      search: row.search ?? null,
      browser: "Chrome",
      os: "macOS",
      device: "desktop" as const,
      country: "US",
    }))
  );
}

function report(from = DAY, to = DAY, now = LATER) {
  return getTrafficAs(STAFF, { from, to }, now);
}

describe("a visit", () => {
  it("is split by a 31-minute gap and not by a 30-minute one", async () => {
    await events(
      { at: at(DAY, "10:00"), hash: "a" },
      { at: at(DAY, "10:30"), hash: "a" },
      { at: at(DAY, "11:01"), hash: "a" }
    );
    const view = await report();
    expect(view.headline.visits.current).toBe(2);
    expect(view.headline.views.current).toBe(3);
  });

  it("ends at local midnight, so one across it counts twice", async () => {
    await events(
      { at: at(DAY, "23:50"), hash: "night" },
      { at: at(NEXT_DAY, "00:05"), hash: "night" }
    );
    const view = await report(DAY, NEXT_DAY);
    expect(view.headline.visits.current).toBe(2);
  });

  it("belongs to one hash: two hashes at the same moment are two visits", async () => {
    await events(
      { at: at(DAY, "10:00"), hash: "a" },
      { at: at(DAY, "10:00"), hash: "b" }
    );
    expect((await report()).headline.visits.current).toBe(2);
  });
});

describe("a bounce", () => {
  it("is a visit with one event; a view and then a search is not one", async () => {
    await events(
      { at: at(DAY, "09:00"), hash: "one" },
      { at: at(DAY, "09:00"), hash: "two" },
      {
        at: at(DAY, "09:01"),
        hash: "two",
        kind: "search",
        pathname: "/projects",
      }
    );
    expect((await report()).headline.bounceRate.current).toBe(0.5);
  });

  it("has no rate at all when there were no visits", async () => {
    expect((await report()).headline.bounceRate.current).toBeNull();
  });
});

describe("the entry page", () => {
  it("is the visit's first view, not a search before it", async () => {
    await events(
      {
        at: at(DAY, "10:00"),
        hash: "e",
        kind: "search",
        pathname: "/projects",
        search: { q: "robot" },
      },
      {
        at: at(DAY, "10:02"),
        hash: "e",
        pathname: "/inventory",
        referrer: "www.google.com",
      },
      { at: at(DAY, "10:05"), hash: "e", pathname: "/privacy" }
    );
    const view = await report();
    expect(view.breakdowns.entryPages).toEqual([
      { pathname: "/inventory", title: null, visits: 1 },
    ]);
    expect(view.breakdowns.referrers).toEqual([
      { key: "www.google.com", visits: 1 },
    ]);
  });
});

describe("average daily visitors", () => {
  it("counts each hash once a day and averages over every day, empty ones too", async () => {
    await events(
      { at: at(DAY, "10:00"), hash: "a" },
      { at: at(DAY, "11:00"), hash: "a" },
      { at: at(DAY, "12:00"), hash: "b" },
      { at: at(NEXT_DAY, "10:00"), hash: "c" }
    );
    // Three visitor-days over a four-day range: 0.75, not 1.5.
    const view = await report(DAY, "2026-05-15");
    expect(view.headline.dailyVisitors.current).toBe(0.75);
    expect(view.daily.map((d) => d.day)).toEqual([
      "2026-05-12",
      "2026-05-13",
      "2026-05-14",
      "2026-05-15",
    ]);
  });
});

describe("views per project", () => {
  async function project(title: string, status: string, deleted = false) {
    const [row] = await db
      .insert(projects)
      .values({
        title,
        status: status as "published",
        deletedAt: deleted ? new Date() : null,
      })
      .returning();
    return row;
  }

  it("lists every published project, zeros included, and nothing unpublished or deleted", async () => {
    const read = await project("Read", "published");
    const unread = await project("Unread", "published");
    await project("Draft", "draft");
    await project("Gone", "published", true);
    await events(
      { at: at(DAY, "10:00"), hash: "a", pathname: `/projects/${read.id}` },
      { at: at(DAY, "10:01"), hash: "a", pathname: `/projects/${read.id}` },
      { at: at(DAY, "10:00"), hash: "b", pathname: `/projects/${read.id}` }
    );
    const view = await report();
    expect(view.projects).toEqual([
      { id: read.id, title: "Read", views: 3, visits: 2 },
      { id: unread.id, title: "Unread", views: 0, visits: 0 },
    ]);
    expect(view.pages[0]).toMatchObject({
      pathname: `/projects/${read.id}`,
      title: "Read",
      views: 3,
      visits: 2,
    });
  });
});

describe("filter use", () => {
  it("is the share of visits to a listing that set a filter at least once", async () => {
    const defaults: TrafficSearch = {
      q: "",
      categories: [],
      program: null,
      acceptingOnly: true,
      archivedOnly: false,
    };
    await events(
      {
        at: at(DAY, "10:00"),
        hash: "a",
        pathname: "/projects",
        search: defaults,
      },
      {
        at: at(DAY, "10:01"),
        hash: "a",
        kind: "search",
        pathname: "/projects",
        search: { ...defaults, q: "robot", acceptingOnly: false },
      },
      {
        at: at(DAY, "10:00"),
        hash: "b",
        pathname: "/projects",
        search: defaults,
      },
      {
        at: at(DAY, "10:00"),
        hash: "c",
        pathname: "/inventory",
        search: { q: "", categories: [], status: null, view: "table" },
      }
    );
    const view = await report();
    const projectsUse = view.filterUse.find((u) => u.listing === "/projects");
    const inventoryUse = view.filterUse.find((u) => u.listing === "/inventory");
    expect(projectsUse?.visits).toBe(2);
    const set = (key: string) =>
      projectsUse?.filters.find((f) => f.key === key)?.visits;
    expect(set("q")).toBe(1);
    expect(set("acceptingOnly")).toBe(1);
    expect(set("archivedOnly")).toBe(0);
    expect(set("categories")).toBe(0);
    expect(inventoryUse?.visits).toBe(1);
    expect(inventoryUse?.filters.find((f) => f.key === "view")?.visits).toBe(1);
  });
});

describe("the previous period", () => {
  it("is the same number of days just before, read the same way", async () => {
    await events(
      { at: at("2026-05-10", "10:00"), hash: "old" },
      { at: at("2026-05-11", "10:00"), hash: "old2" },
      { at: at(DAY, "10:00"), hash: "new" }
    );
    const view = await report(DAY, NEXT_DAY);
    expect(view.range).toMatchObject({
      previousFrom: "2026-05-10",
      previousTo: "2026-05-11",
    });
    expect(view.headline.visits).toEqual({ current: 1, previous: 2 });
  });
});

describe("the rollup", () => {
  it("serves a closed day with the same figures the events give live", async () => {
    await events(
      { at: at(DAY, "10:00"), hash: "a", referrer: "www.bing.com" },
      { at: at(DAY, "10:10"), hash: "a", pathname: "/projects" },
      { at: at(DAY, "12:00"), hash: "b" }
    );
    // The same afternoon: the day is still open, so it is derived live.
    const live = await report(DAY, DAY, at(DAY, "18:00"));
    expect(await db.select().from(trafficVisits)).toHaveLength(0);
    const rolled = await report(DAY, DAY, LATER);
    expect(await db.select().from(trafficVisits)).toHaveLength(2);
    expect(rolled).toEqual(live);
  });

  it("waits out the settle margin after midnight before closing a day", async () => {
    await events({ at: at(DAY, "23:59"), hash: "late" });
    await rollUpTrafficVisits(at(NEXT_DAY, "00:01"));
    expect(await db.select().from(trafficVisits)).toHaveLength(0);
    await rollUpTrafficVisits(at(NEXT_DAY, "00:03"));
    expect(await db.select().from(trafficVisits)).toHaveLength(1);
  });

  it("rolls each day up once, even when two loads race", async () => {
    await events(
      { at: at(DAY, "10:00"), hash: "a" },
      { at: at(NEXT_DAY, "10:00"), hash: "b" }
    );
    await Promise.all([
      rollUpTrafficVisits(LATER),
      rollUpTrafficVisits(LATER),
      rollUpTrafficVisits(LATER),
    ]);
    await rollUpTrafficVisits(LATER);
    const rows = await db.execute<{ day: string; n: number }>(
      sql`SELECT day::text AS day, count(*)::int AS n FROM traffic_visits GROUP BY day ORDER BY day`
    );
    expect(rows.rows).toEqual([
      { day: DAY, n: 1 },
      { day: NEXT_DAY, n: 1 },
    ]);
  });

  it("keeps no visitor hash", async () => {
    await events({ at: at(DAY, "10:00"), hash: "secret-hash" });
    await rollUpTrafficVisits(LATER);
    const [row] = await db.select().from(trafficVisits);
    expect(JSON.stringify(row)).not.toContain("secret-hash");
  });
});

describe("access", () => {
  it("refuses a viewer who is not staff", async () => {
    await expect(
      getTrafficAs({ id: "u", role: "user" }, { from: DAY, to: DAY }, LATER)
    ).rejects.toThrow();
  });
});
