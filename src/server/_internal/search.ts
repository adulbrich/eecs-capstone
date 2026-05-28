import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { programs, projectCategories, projects } from "#/db/schema";
import type { SearchProjectsInput } from "../search";
import { projectSummarySelect } from "./project-summary";

export async function searchProjectsImpl(data: SearchProjectsInput) {
  const trimmed = data.query.trim();
  const conditions = [
    eq(projects.status, data.archivedOnly ? "archived" : "published"),
    isNull(projects.deletedAt),
  ];
  if (trimmed) {
    conditions.push(
      sql`${projects.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`,
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

  const orderBy = trimmed
    ? sql`ts_rank(${projects.searchVector}, websearch_to_tsquery('english', ${trimmed})) DESC, ${projects.publishedAt} DESC`
    : desc(projects.publishedAt);

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
