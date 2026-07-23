import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  if (data.categoryIds.length > 0) {
    const matchingProjectIds = db
      .select({ projectId: projectCategories.projectId })
      .from(projectCategories)
      .where(inArray(projectCategories.categoryId, data.categoryIds))
      .groupBy(projectCategories.projectId)
      .having(sql`count(*) = ${data.categoryIds.length}`);
    conditions.push(inArray(projects.id, matchingProjectIds));
  }

  // "relevance" is the default because ordering used to be implicit: a query
  // ranked by ts_rank, everything else by date. Defaulting to "newest" would
  // silently reorder every existing keyword search.
  const relevanceOrder = trimmed
    ? sql`ts_rank(${projects.searchVector}, websearch_to_tsquery('english', ${trimmed})) DESC, ${projects.publishedAt} DESC`
    : desc(projects.publishedAt);

  let orderBy = relevanceOrder;
  if (data.sort === "newest") {
    orderBy = desc(projects.publishedAt);
  } else if (data.sort === "recommended" && viewerId) {
    const [interests] = await db
      .select({ embedding: userInterests.embedding })
      .from(userInterests)
      .where(eq(userInterests.userId, viewerId));
    if (interests?.embedding) {
      const probe = toSqlVector(interests.embedding);
      // Null embeddings sort last rather than being filtered out: a project
      // that failed to embed must stay reachable.
      orderBy = sql`${projects.embedding} IS NULL, ${projects.embedding} <=> ${probe}::vector`;
    }
  }

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
  };
}
