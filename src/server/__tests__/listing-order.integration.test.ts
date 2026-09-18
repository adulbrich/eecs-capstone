import { eq } from "drizzle-orm";
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
 * The row count and the page size are load-bearing; "Paging a listing needs a
 * total ordering" in docs/QUIRKS.md says why, and this file does not repeat it.
 * Each of the five "exactly once" tests below was watched failing against the
 * unfixed ordering, at these numbers, before the fix went in. Do not trim them.
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
type Ordering = NonNullable<Parameters<typeof searchProjectsImpl>[0]["sort"]>;

async function pageThrough(
  sort: Ordering,
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

  /**
   * The three orderings #475 added, over the same wholly tied cohort. Each
   * one ties on its own key for all 400 rows: they share a title, they share
   * `published_at`, and they were inserted in one statement so they share
   * `updated_at` too. Only the `projects.id` tie break separates them, which
   * is the property these tests exist to hold.
   *
   * Title is the one a reader would notice breaking: it is the ordering the
   * column header used to offer, and page-local sorting is exactly what made
   * page two restart the alphabet.
   */
  for (const sort of ["oldest", "title", "updated"] as const) {
    it(`visits each project exactly once under ${sort}`, async () => {
      const ids = await insertTiedProjects(null);
      expectVisitsEachExactlyOnce(await pageThrough(sort, "", null), ids);
    });
  }

  // Resolves to `newest` on the server since #475, so this is the same
  // ordering as the case above reached by the other route. Kept because the
  // route it comes in by is a URL a reader can still paste.
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
    const viewerId = await makeViewer("viewer@x.com");
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
    const viewerId = await makeViewer("viewer@x.com");
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
   * Weaker than the five above on purpose, and it was never watched failing:
   * two identical queries over unchanged data take the same plan and return
   * the same rows, duplicates and all. It is here because the issue asks for
   * it, and because it would catch an ordering made total by something that is
   * not stable, a random or a clock, which the id is not.
   */
  it("returns the same order when the same query runs twice", async () => {
    await insertTiedProjects(null);
    const first = await pageThrough("newest", "", null);
    const second = await pageThrough("newest", "", null);
    expect(second).toEqual(first);
  });

  /** The tie break must not reorder anything that was already ordered. */
  it("leaves projects that were never tied in date order", async () => {
    // Three distinct dates, so nothing reaches the terminal key at all and the
    // ordering is entirely the one that existed before this change.
    for (const [title, day] of [
      ["Older", "2026-01-01"],
      ["Middle", "2026-02-01"],
      ["Newer", "2026-03-01"],
    ] as const) {
      await db.insert(projects).values({
        title,
        status: "published",
        publishedAt: new Date(`${day}T00:00:00.000Z`),
      });
    }

    // No filtering and no cleanup: `setup.integration.ts` truncates in
    // `beforeEach`, so these three are the only projects that exist.
    const { rows } = await searchProjectsImpl(
      { ...SEARCH_DEFAULTS, sort: "newest", query: "", page: 1 },
      null
    );
    expect(rows.map((row) => row.title)).toEqual(["Newer", "Middle", "Older"]);
  });
});
