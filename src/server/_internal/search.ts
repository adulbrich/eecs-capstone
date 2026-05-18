import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";
import type { SearchProjectsInput } from "../search";

export async function searchProjectsImpl(data: SearchProjectsInput) {
  const trimmed = data.query.trim();
  const conditions = [
    eq(projects.status, "published"),
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
    conditions.push(
      sql`${projects.id} IN (
        SELECT project_id FROM project_categories
        WHERE category_id = ANY(${data.categoryIds}::uuid[])
        GROUP BY project_id
        HAVING count(*) = ${data.categoryIds.length}
      )`,
    );
  }

  const orderBy = trimmed
    ? sql`ts_rank(${projects.searchVector}, websearch_to_tsquery('english', ${trimmed})) DESC, ${projects.publishedAt} DESC`
    : desc(projects.publishedAt);

  const offset = (data.page - 1) * data.pageSize;
  const rows = await db
    .select()
    .from(projects)
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
