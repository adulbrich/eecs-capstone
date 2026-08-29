import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  notifications,
} from "#/db/schema";
import { overdueNotifications } from "#/lib/inventory-notifications";
import type { Viewer } from "#/lib/viewer";

/**
 * Common shape both scans below normalize their rows to before the single
 * push loop. `userId` is nullable here on purpose: the hold scan's query
 * conditions already exclude unresolved holds (see below), but the type
 * stays honest about the column it came from until the explicit filter.
 */
interface OverdueCandidate {
  dueAt: Date | null;
  itemId: string;
  itemName: string;
  pickupBy: Date | null;
  status: string;
  userId: string | null;
}

/**
 * Lazy idempotent insert of overdue notifications. Scoped to a single owner
 * when {ownerId} is provided so the my-items read path does not scan every
 * approved line in the system.
 *
 * Idempotency: the partial unique index `notifications_overdue_unique_idx`
 * on (user_id, type, link) WHERE type IN (the two overdue types) lets
 * onConflictDoNothing skip duplicates. The target + where clause make the
 * arbiter explicit so adding another unique index on `notifications`
 * cannot silently swallow unrelated conflicts.
 */
export async function recordOverdueNotificationsAs(
  viewer: Viewer,
  opts: { ownerId?: string } = {}
) {
  if (!viewer) {
    return;
  }
  const conditions = [eq(inventoryRequestItems.status, "approved")];
  if (opts.ownerId) {
    conditions.push(eq(inventoryRequests.userId, opts.ownerId));
  }
  const requestRows: OverdueCandidate[] = await db
    .select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      status: inventoryItems.status,
      pickupBy: inventoryRequestItems.pickupBy,
      dueAt: inventoryRequestItems.dueAt,
      userId: inventoryRequests.userId,
    })
    .from(inventoryRequestItems)
    .innerJoin(
      inventoryRequests,
      eq(inventoryRequestItems.requestId, inventoryRequests.id)
    )
    .innerJoin(
      inventoryItems,
      eq(inventoryRequestItems.itemId, inventoryItems.id)
    )
    .where(and(...conditions));

  // The hold scan and the request scan used to be disjoint, because a held
  // item always had either a request line or a holder, never both meaningfully.
  // Now that a teammate can collect someone else's requested item, the two
  // deliberately overlap: the requester is accountable for the request and the
  // picker is holding the thing, so both are told. Restricted to holds with a
  // resolved account (current_holder_id IS NOT NULL): notifications.userId is
  // a foreign key, and an email-matched hold has no id to attribute a message
  // to. Resolving the address here would reintroduce, on a write path, the
  // impersonation risk the read path in listMyItemsAs guards against.
  const holdConditions = [
    isNotNull(inventoryItems.currentHolderId),
    inArray(inventoryItems.status, ["reserved", "checked_out"]),
  ];
  if (opts.ownerId) {
    holdConditions.push(eq(inventoryItems.currentHolderId, opts.ownerId));
  }
  const holdRows: OverdueCandidate[] = await db
    .select({
      itemId: inventoryItems.id,
      itemName: inventoryItems.name,
      status: inventoryItems.status,
      pickupBy: inventoryItems.currentPickupBy,
      dueAt: inventoryItems.currentDueAt,
      userId: inventoryItems.currentHolderId,
    })
    .from(inventoryItems)
    .where(and(...holdConditions));

  // Belt and suspenders with the query-level isNotNull above: keep the
  // exclusion of unattributable rows visible here too, rather than trusting
  // the query alone to have filtered them out before they reach the push
  // loop that assumes a non-null userId.
  const candidates = [...requestRows, ...holdRows].filter(
    (r): r is OverdueCandidate & { userId: string } => r.userId !== null
  );

  // The rows these candidates are owed, including the dedupe: two scans that
  // deliberately overlap, so the same person can appear twice. The rule lives
  // in `src/lib/inventory-notifications.ts` and is unit tested there.
  const values = overdueNotifications(candidates);

  if (values.length === 0) {
    return;
  }
  await db
    .insert(notifications)
    .values(values)
    .onConflictDoNothing({
      target: [notifications.userId, notifications.type, notifications.link],
      where: sql`type IN ('inventory_pickup_overdue', 'inventory_checkout_overdue')`,
    });
}
