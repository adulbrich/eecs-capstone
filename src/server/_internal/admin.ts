import { and, eq, exists, isNull, or, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  inventoryCustomLines,
  inventoryRequestItems,
  inventoryRequests,
  projects,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { assertStaff, type Viewer } from "#/lib/viewer";

/** `count(*)` as a number, for every figure here and on the dashboard. */
export function countRows() {
  return sql<number>`count(*)::int`;
}

/**
 * Distinct requests with at least one pending line: the number of cards on
 * `/admin/inventory/requests?tab=pending`. One query, shared by `/admin` and
 * the analytics dashboard, so the two cannot drift (#34).
 */
export async function countPendingRequests(): Promise<number> {
  // Envelopes, not lines, and of either kind: a custom request holds no
  // item line at all, so counting `inventory_request_items` alone would
  // leave a pending custom request off the tile.
  const pendingItemLine = exists(
    db
      .select({ one: sql`1` })
      .from(inventoryRequestItems)
      .where(
        and(
          eq(inventoryRequestItems.requestId, inventoryRequests.id),
          eq(inventoryRequestItems.status, "pending")
        )
      )
  );
  const pendingCustomLine = exists(
    db
      .select({ one: sql`1` })
      .from(inventoryCustomLines)
      .where(
        and(
          eq(inventoryCustomLines.requestId, inventoryRequests.id),
          eq(inventoryCustomLines.status, "pending")
        )
      )
  );
  const [row] = await db
    .select({ pendingRequests: sql<number>`count(*)::int` })
    .from(inventoryRequests)
    .where(or(pendingItemLine, pendingCustomLine));
  return row?.pendingRequests ?? 0;
}

/** Projects awaiting review. Shared with the dashboard for the same reason. */
export async function countSubmitted(programId: string | null = null) {
  const [row] = await db
    .select({ submitted: countRows() })
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
export async function getAdminStatsAs(viewer: NonNullable<Viewer>) {
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
