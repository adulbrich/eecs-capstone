import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { inventoryRequestItems, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { assertStaff } from "#/lib/viewer";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

function count() {
  return sql<number>`count(*)::int`;
}

/**
 * Distinct requests with at least one pending line: the number of cards on
 * `/admin/inventory/requests?tab=pending`. One query, shared by `/admin` and
 * the analytics dashboard, so the two cannot drift (#34).
 */
export async function countPendingRequests(): Promise<number> {
  const [row] = await db
    .select({
      pendingRequests: sql<number>`count(distinct ${inventoryRequestItems.requestId})::int`,
    })
    .from(inventoryRequestItems)
    .where(eq(inventoryRequestItems.status, "pending"));
  return row?.pendingRequests ?? 0;
}

/** Projects awaiting review. Shared with the dashboard for the same reason. */
export async function countSubmitted(programId: string | null = null) {
  const [row] = await db
    .select({ submitted: count() })
    .from(projects)
    .where(
      and(
        sql`${projects.status} = 'submitted'`,
        isNull(projects.deletedAt),
        programId ? eq(projects.programId, programId) : undefined
      )
    );
  return row?.submitted ?? 0;
}

/**
 * The two work-queue figures `/admin` keeps: a number you can act on today.
 * The overview counts it used to carry moved to `/admin/analytics`, where a
 * date range and a program selector make them mean something (#34).
 */
export async function getAdminStatsAs(viewer: AuthUser) {
  assertStaff(viewer);
  const [submitted, pendingRequests] = await Promise.all([
    countSubmitted(),
    countPendingRequests(),
  ]);
  return { submitted, pendingRequests };
}

export async function getAdminStatsForCurrentUser() {
  const viewer = await requireUser();
  return getAdminStatsAs(viewer);
}
