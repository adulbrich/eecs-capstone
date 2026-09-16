import { eq, inArray } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { projects, user, userInterests } from "#/db/schema";
import { auth } from "#/lib/auth";
import { searchProjectsImpl } from "#/server/_internal/search";

/**
 * Paging correctness, which is a property of the ordering rather than of any
 * one page: `searchProjectsImpl` runs each page as its own `LIMIT`/`OFFSET`
 * query, so an ordering that leaves rows tied lets Postgres return them in a
 * different relative order per page. A row then appears twice, and another
 * never appears at all (#429).
 *
 * The row count is load-bearing and was arrived at empirically, so do not trim
 * it. At 25 tied rows over a page of 10 these tests pass against the unfixed
 * ordering, because the whole set fits one sort and Postgres happens to return
 * it consistently. At 400 over a page of 20 the planner uses a top-N heapsort,
 * whose contents differ per `OFFSET`, and the unfixed ordering returns 400 rows
 * of which only 392 are distinct: 8 projects twice and 8 not at all. Every
 * assertion below was watched failing that way before the fix went in.
 *
 * Rows are inserted straight rather than driven through the workflow. What is
 * under test is the `ORDER BY`, and 400 projects through four transitions each
 * is minutes of setup to prove nothing extra.
 */
const TIED_AT = new Date("2026-03-01T12:00:00.000Z");
const ROW_COUNT = 400;
const PAGE_SIZE = 20;

/** Unit vectors in a 1024-dim space, so cosine distance is predictable. */
function unitVector(axis: number) {
  return Array.from({ length: 1024 }, (_, i) => (i === axis ? 1 : 0));
}

async function makeViewer(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return u.id;
}

/**
 * `ROW_COUNT` published projects sharing one `published_at` to the
 * millisecond, which is the state 271 of the 699 legacy projects are in: rows
 * imported with no publish date fall back to a `created_at` carrying a fixed
 * noon time, so whole cohorts share a timestamp.
 *
 * Identical titles and descriptions as well, so they tie on `ts_rank` too and
 * the relevance ordering has the same problem as the date ones.
 */
async function insertTiedProjects(vector: number[] | null) {
  const rows = await db
    .insert(projects)
    .values(
      Array.from({ length: ROW_COUNT }, () => ({
        title: "Tied cohort project",
        description: "robotics and sensors",
        status: "published" as const,
        publishedAt: TIED_AT,
        embedding: vector,
        embeddingSourceHash: vector ? "test" : null,
      }))
    )
    .returning({ id: projects.id });
  return rows.map((row) => row.id);
}

const SEARCH_DEFAULTS = {
  query: "",
  categoryIds: [],
  programId: null,
  archivedOnly: false,
  acceptingOnly: false,
  studentProposedOnly: false,
  requiresNdaOnly: false,
  pageSize: PAGE_SIZE,
};

/** Every id the listing hands back, page by page, in page order. */
async function pageThrough(
  sort: "relevance" | "newest" | "recommended",
  query: string,
  viewerId: string | null
) {
  const seen: string[] = [];
  const first = await searchProjectsImpl(
    { ...SEARCH_DEFAULTS, sort, query, page: 1 },
    viewerId
  );
  const pages = Math.ceil(first.total / PAGE_SIZE);
  seen.push(...first.rows.map((row) => row.id));
  for (let page = 2; page <= pages; page++) {
    const next = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort, query, page },
      viewerId
    );
    seen.push(...next.rows.map((row) => row.id));
  }
  return seen;
}

function expectVisitsEachExactlyOnce(seen: string[], expected: string[]) {
  expect(new Set(seen).size).toBe(seen.length);
  expect([...seen].sort()).toEqual([...expected].sort());
}

describe("paging a listing whose rows tie on every sort key", () => {
  it("visits each project exactly once under newest", async () => {
    const ids = await insertTiedProjects(null);
    expectVisitsEachExactlyOnce(await pageThrough("newest", "", null), ids);
  });

  it("visits each project exactly once under relevance with no query", async () => {
    const ids = await insertTiedProjects(null);
    expectVisitsEachExactlyOnce(await pageThrough("relevance", "", null), ids);
  });

  /**
   * The query matches every row and ranks them identically, so `ts_rank` ties
   * as completely as the date does and the second key carries none of the
   * ordering.
   */
  it("visits each project exactly once under relevance with a query", async () => {
    const ids = await insertTiedProjects(null);
    expectVisitsEachExactlyOnce(
      await pageThrough("relevance", "robotics", null),
      ids
    );
  });

  it("visits each project exactly once under recommended", async () => {
    const ids = await insertTiedProjects(unitVector(0));
    const viewerId = await makeViewer(`rec-${Date.now()}@x.com`);
    await db.insert(userInterests).values({
      userId: viewerId,
      interestsText: "robotics",
      embedding: unitVector(0),
      embeddingSourceHash: "test",
    });

    expectVisitsEachExactlyOnce(
      await pageThrough("recommended", "", viewerId),
      ids
    );
  });

  /**
   * The worst case for the recommended sort, and the state the whole of the
   * archive was in before #427: `embedding IS NULL` is true for every row and
   * the distance is null for every row, so both of that ordering's own keys
   * tie and the listing date plus the id are all that remain.
   */
  it("visits each project exactly once under recommended with no vector on any row", async () => {
    const ids = await insertTiedProjects(null);
    const viewerId = await makeViewer(`null-${Date.now()}@x.com`);
    await db.insert(userInterests).values({
      userId: viewerId,
      interestsText: "robotics",
      embedding: unitVector(0),
      embeddingSourceHash: "test",
    });

    expectVisitsEachExactlyOnce(
      await pageThrough("recommended", "", viewerId),
      ids
    );
  });

  it("returns the same order when the same query runs twice", async () => {
    await insertTiedProjects(null);
    const first = await pageThrough("newest", "", null);
    const second = await pageThrough("newest", "", null);
    expect(second).toEqual(first);
  });

  /**
   * The tie break must not reorder anything that was already ordered. Three
   * distinct dates, so nothing reaches the terminal key at all.
   */
  it("leaves projects that were never tied in date order", async () => {
    const [older] = await db
      .insert(projects)
      .values({
        title: "Older",
        status: "published",
        publishedAt: new Date("2026-01-01T00:00:00.000Z"),
      })
      .returning({ id: projects.id });
    const [middle] = await db
      .insert(projects)
      .values({
        title: "Middle",
        status: "published",
        publishedAt: new Date("2026-02-01T00:00:00.000Z"),
      })
      .returning({ id: projects.id });
    const [newer] = await db
      .insert(projects)
      .values({
        title: "Newer",
        status: "published",
        publishedAt: new Date("2026-03-01T00:00:00.000Z"),
      })
      .returning({ id: projects.id });

    const { rows } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "newest", query: "", page: 1 },
      null
    );
    const ours = rows
      .filter((row) => [older.id, middle.id, newer.id].includes(row.id))
      .map((row) => row.title);
    expect(ours).toEqual(["Newer", "Middle", "Older"]);

    await db
      .delete(projects)
      .where(inArray(projects.id, [older.id, middle.id, newer.id]));
  });
});
