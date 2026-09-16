import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  programs,
  projectCategories,
  projects,
  userInterests,
} from "#/db/schema";
import { readSession } from "#/lib/_internal/auth-guards";
import type { SearchProjectsInput } from "../search";
import { toSqlVector } from "./project-embeddings";
import { projectSummarySelect } from "./project-summary";

/**
 * Request entry point: resolves the viewer, then delegates. Tests call
 * `searchProjectsImpl` directly with an explicit viewer id instead.
 */
export async function searchProjectsForRequest(data: SearchProjectsInput) {
  const session = await readSession();
  return searchProjectsImpl(data, session?.user?.id ?? null);
}

/** The viewer's interest vector, or null for a visitor or a member without one. One indexed row. */
async function interestsVectorFor(
  viewerId: string | null
): Promise<number[] | null> {
  if (!viewerId) {
    return null;
  }
  const [row] = await db
    .select({ embedding: userInterests.embedding })
    .from(userInterests)
    .where(eq(userInterests.userId, viewerId));
  return row?.embedding ?? null;
}

export async function searchProjectsImpl(
  data: SearchProjectsInput,
  viewerId: string | null = null
) {
  const trimmed = data.query.trim();
  const conditions = [
    eq(projects.status, data.archivedOnly ? "archived" : "published"),
    isNull(projects.deletedAt),
  ];
  if (trimmed) {
    conditions.push(
      sql`${projects.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`
    );
  }
  if (data.programId) {
    conditions.push(eq(projects.programId, data.programId));
  }
  if (data.acceptingOnly) {
    conditions.push(eq(projects.acceptingApplicants, true));
  }
  if (data.studentProposedOnly) {
    conditions.push(eq(projects.studentProposed, true));
  }
  if (data.requiresNdaOnly) {
    conditions.push(eq(projects.requiresNdaIp, true));
  }
  if (data.categoryIds.length > 0) {
    const matchingProjectIds = db
      .select({ projectId: projectCategories.projectId })
      .from(projectCategories)
      .where(inArray(projectCategories.categoryId, data.categoryIds))
      .groupBy(projectCategories.projectId)
      .having(sql`count(*) = ${data.categoryIds.length}`);
    conditions.push(inArray(projects.id, matchingProjectIds));
  }

  /**
   * The date the listing sorts on. `publishedAt` alone is wrong for the
   * archive: `archivedOnly` above resolves to `status = 'archived'` for a null
   * viewer, so the archive is public, and the 302 projects imported from the
   * legacy portal with no publish date (its event log only starts 2022-08-03)
   * carry a null there. Postgres `DESC` is NULLS FIRST, so ordering on the
   * bare column floats every dateless row above everything with a real date.
   *
   * `createdAt` rather than `updatedAt` as the fallback, for two reasons.
   * `updatedAt` moves on every edit, so one staff typo fix would jump a 2019
   * project to the top of "newest"; and measured against the 245 imported
   * rows that do have a publish date, `createdAt` is the closer estimate
   * (mean error 15.8 days against 37.0).
   *
   * A no-op for anything proposed in this app, where `publishedAt` is set on
   * every publish. `projects_published_at_idx` does not serve this ordering;
   * at the row counts here that costs nothing, and an expression index is the
   * fix if it ever does.
   */
  const listingDate = sql`coalesce(${projects.publishedAt}, ${projects.createdAt})`;

  /**
   * The terminal key on every ordering below, and the only thing that makes
   * paging correct. Each page is its own `LIMIT`/`OFFSET` query, and where
   * rows tie on every sort key Postgres promises nothing about their relative
   * order, so one row can come back on two pages and another on none.
   *
   * Not hypothetical: 271 of the 699 legacy projects share a listing date with
   * at least one other, the largest clusters being 17, 12 and 10 on a single
   * timestamp, because rows imported with no publish date fall back to a
   * `created_at` that carries a fixed noon time. `PAGE_SIZE_DEFAULT` is 20, so
   * a 17-way tie straddles a page boundary, and filtering re-splits the set so
   * it straddles at a different place. An anonymous visitor reaches this on the
   * public archived listing at the default sort (#429).
   *
   * `id` fixes all three orderings because it is unique, which is what makes an
   * ordering ending in it total. Its direction is arbitrary: it only ever runs
   * when everything before it has tied.
   */
  const tieBreak = sql`${projects.id}`;

  // "relevance" is the default because ordering used to be implicit: a query
  // ranked by ts_rank, everything else by date. Defaulting to "newest" would
  // silently reorder every existing keyword search.
  const relevanceOrder = trimmed
    ? sql`ts_rank(${projects.searchVector}, websearch_to_tsquery('english', ${trimmed})) DESC, ${listingDate} DESC, ${tieBreak}`
    : sql`${listingDate} DESC, ${tieBreak}`;

  // Read for every signed-in viewer, not only under `recommended`: the
  // listing tells the reader whether the recommended sort is open to them,
  // and reading that here, in the loader, is what stops the prompt flashing
  // on first paint for someone who already has interests (#321).
  const interestsVector = await interestsVectorFor(viewerId);

  let orderBy = relevanceOrder;
  if (data.sort === "newest") {
    orderBy = sql`${listingDate} DESC, ${tieBreak}`;
  } else if (data.sort === "recommended" && interestsVector) {
    const probe = toSqlVector(interestsVector);
    // Null embeddings sort last rather than being filtered out: a project
    // that failed to embed must stay reachable.
    //
    // The date sits between the distance and the tie break so that the
    // projects sharing the null case are at least ordered by something a
    // reader would recognise. #427 gave every published and archived project a
    // vector, so that group should be empty now; it refills one row at a time
    // whenever an embedding call fails.
    orderBy = sql`${projects.embedding} IS NULL, ${projects.embedding} <=> ${probe}::vector, ${listingDate} DESC, ${tieBreak}`;
  }
  // `recommended` with no vector falls through to relevance silently: a
  // hand-typed `?order=recommended` still renders a page.

  const offset = (data.page - 1) * data.pageSize;
  const rows = await db
    .select(projectSummarySelect)
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .where(and(...conditions))
    .orderBy(orderBy)
    .limit(data.pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(...conditions));

  return {
    rows,
    total: count,
    page: data.page,
    pageSize: data.pageSize,
    /**
     * Whether the recommended sort is open to this viewer, and if not, why:
     * the filter bar shows a sign-in prompt to a visitor and an add-your-
     * interests prompt to a member with no vector. Never the vector itself.
     */
    viewer: {
      signedIn: viewerId !== null,
      canRecommend: interestsVector !== null,
    },
  };
}
