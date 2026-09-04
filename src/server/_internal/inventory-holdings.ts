import {
  and,
  desc,
  eq,
  ilike,
  inArray,
  isNull,
  notExists,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "#/db";
import {
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { holdEmail, holdFromJoinedRow, holdName } from "#/lib/hold";
import { compareByDeadline } from "#/lib/inventory-deadlines";
import {
  type HoldItemView,
  holdItemView,
  type MyRequestLineView,
  myRequestLineView,
} from "#/lib/inventory-visibility";
import { assertStaff, type Viewer } from "#/lib/viewer";
import type { ItemStatus } from "#/lib/vocabularies";
import type { InventoryRequestQueueFilter } from "../inventory";
import { getCartAs } from "./inventory-cart";
import { recordOverdueNotificationsAs } from "./inventory-overdue";

/**
 * An entry in the Active tab.
 *
 * Only a hold carries the item as its subject, because only a hold has no
 * request line. A request carries its line plus the item's name and status: a
 * request's deadlines live on the line, and letting it carry the item's too
 * would put two different `pickupBy` values on one object.
 */
export type ActiveEntry =
  | {
      collectedBy: CollectedBy | null;
      itemName: string;
      itemStatus: ItemStatus;
      kind: "request";
      line: MyRequestLineView;
    }
  | { item: HoldItemView; kind: "hold" };

/**
 * A closed line. The item's current status and dates describe whoever has it
 * now, which is not this record, so only the name comes along.
 */
export interface HistoryEntry {
  collectedBy: CollectedBy | null;
  itemName: string;
  line: MyRequestLineView;
}

/**
 * The items a viewer is currently holding: a live hold assigned to their
 * account, or to their address when no account holds it. The address half
 * needs a verified address, or anyone could take an item by typing its
 * holder's email into their profile, and it never overrides an explicit
 * account assignment. The address is compared case-insensitively, the way
 * claimProjectsForVerifiedUser and mentorNameSql compare theirs: a walk-in
 * hold that staff typed as Student@Oregonstate.edu belongs to the account at
 * student@oregonstate.edu. resolveHold folds the same way at write time, so
 * this arm now catches holds typed before it did, and holds assigned while no
 * account existed yet.
 *
 * One predicate, read by /my/items and by account deletion, so the page that
 * shows a person their items and the check that refuses to delete their
 * account while they hold one cannot disagree about what "hold" means.
 */
export function heldByViewer(
  viewerId: string,
  verifiedEmail: string | null
): SQL | undefined {
  return and(
    inArray(inventoryItems.status, ["reserved", "checked_out"]),
    or(
      eq(inventoryItems.currentHolderId, viewerId),
      verifiedEmail
        ? and(
            isNull(inventoryItems.currentHolderId),
            sql`lower(${inventoryItems.currentHolderEmail}) = ${verifiedEmail.toLowerCase()}`
          )
        : undefined
    )
  );
}

export async function listMyItemsAs(viewer: Viewer) {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  // Notifications are a side-effect; never let them block the read. There is
  // no cron (see QUIRKS), so this read is genuinely the trigger, and a failure
  // here must not 500 the page.
  //
  // It is reported rather than discarded. A bare `catch {}` here meant that if
  // this stopped working, every overdue notification stopped with it and
  // nobody found out, because the page carried on looking fine.
  try {
    await recordOverdueNotificationsAs(viewer, { ownerId: viewer.id });
  } catch (error) {
    console.error(
      `Overdue notification recording failed for user ${viewer.id}`,
      error
    );
  }
  // Only a verified address may claim a hold: otherwise anyone could take
  // someone else's item by editing their own email in the profile form.
  const [account] = await db
    .select({ email: user.email, verified: user.emailVerified })
    .from(user)
    .where(eq(user.id, viewer.id));
  const verifiedEmail = account?.verified ? account.email : null;

  const [cart, activeLines, holds, history] = await Promise.all([
    getCartAs(viewer),
    db
      .select({
        line: inventoryRequestItems,
        item: inventoryItems,
        request: inventoryRequests,
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
      .where(
        and(
          eq(inventoryRequests.userId, viewer.id),
          inArray(inventoryRequestItems.status, ["pending", "approved"])
        )
      )
      .orderBy(desc(inventoryRequestItems.createdAt)),
    db
      .select({ item: inventoryItems })
      .from(inventoryItems)
      .where(
        and(
          // The point of this condition was always "an item must not appear
          // twice on one person's page", not "a held item has no request".
          // Stated that way it also lets a teammate who collected someone
          // else's requested item see the hold they are actually carrying.
          //
          // The status filter has to be the same one the request half above
          // uses, or the two stop partitioning: an item pointing at a closed
          // line would be excluded here as a duplicate of a row that half
          // never returns, and would vanish from the tab entirely.
          notExists(
            db
              .select({ one: sql`1` })
              .from(inventoryRequestItems)
              .innerJoin(
                inventoryRequests,
                eq(inventoryRequestItems.requestId, inventoryRequests.id)
              )
              .where(
                and(
                  eq(
                    inventoryRequestItems.id,
                    inventoryItems.currentRequestItemId
                  ),
                  eq(inventoryRequests.userId, viewer.id),
                  inArray(inventoryRequestItems.status, ["pending", "approved"])
                )
              )
          ),
          heldByViewer(viewer.id, verifiedEmail)
        )
      ),
    db
      .select({
        line: inventoryRequestItems,
        item: inventoryItems,
        request: inventoryRequests,
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
      .where(
        and(
          eq(inventoryRequests.userId, viewer.id),
          inArray(inventoryRequestItems.status, [
            "rejected",
            "cancelled",
            "returned",
          ])
        )
      )
      .orderBy(desc(inventoryRequestItems.updatedAt))
      .limit(50),
  ]);

  const collected = await collectedByForRequestItems([
    ...activeLines.map((r) => r.line.id),
    ...history.map((r) => r.line.id),
  ]);

  // Every row on this page belongs to the viewer as requester, so a collector
  // who is the viewer is the ordinary case, not news: drop it. A collector
  // identified only by an address that happens to be the viewer's own is the
  // same case with no resolved account. A collector with neither a name nor
  // an address to print (a label hold) has nothing worth showing either.
  const collectedByForViewer = (lineId: string): CollectedBy | null => {
    const collector = collected.get(lineId) ?? null;
    if (!collector) {
      return null;
    }
    const isViewer =
      collector.id === viewer.id ||
      (account?.email != null && collector.email === account.email);
    if (isViewer) {
      return null;
    }
    return collector.name || collector.email ? collector : null;
  };

  const active: ActiveEntry[] = [
    ...activeLines.map(
      (row): ActiveEntry => ({
        kind: "request",
        collectedBy: collectedByForViewer(row.line.id),
        itemName: row.item.name,
        itemStatus: row.item.status,
        line: myRequestLineView(row.line),
      })
    ),
    ...holds.map(
      (row): ActiveEntry => ({ kind: "hold", item: holdItemView(row.item) })
    ),
  ].sort(compareByDeadline);

  return {
    cart,
    active,
    history: history.map(
      (row): HistoryEntry => ({
        itemName: row.item.name,
        line: myRequestLineView(row.line),
        collectedBy: collectedByForViewer(row.line.id),
      })
    ),
  };
}

export interface CollectedBy {
  email: string | null;
  id: string | null;
  name: string | null;
}

/**
 * Who physically collected each request line, read off the checked_out row in
 * the status history.
 *
 * History is the record rather than a pair of picked_up_by columns on
 * inventory_request_items: transitionItem is already the single writer of
 * that table, so there is nothing to keep in sync, and the fact survives the
 * return, which clears the item's own holder columns.
 *
 * One DISTINCT ON for a whole page of lines, not one query per line. The
 * ORDER BY must lead with the same column as the DISTINCT ON; the createdAt
 * DESC that follows is what picks the most recent checkout when a line was
 * checked out more than once.
 */
export async function collectedByForRequestItems(
  lineIds: string[]
): Promise<Map<string, CollectedBy>> {
  if (lineIds.length === 0) {
    return new Map();
  }
  const rows = await db
    .selectDistinctOn([inventoryItemStatusHistory.requestItemId], {
      requestItemId: inventoryItemStatusHistory.requestItemId,
      holderId: inventoryItemStatusHistory.holderId,
      holderEmail: inventoryItemStatusHistory.holderEmail,
      holderName: inventoryItemStatusHistory.holderName,
      accountEmail: user.email,
      accountName: user.name,
    })
    .from(inventoryItemStatusHistory)
    .leftJoin(user, eq(inventoryItemStatusHistory.holderId, user.id))
    .where(
      and(
        eq(inventoryItemStatusHistory.newStatus, "checked_out"),
        inArray(inventoryItemStatusHistory.requestItemId, lineIds)
      )
    )
    .orderBy(
      inventoryItemStatusHistory.requestItemId,
      desc(inventoryItemStatusHistory.createdAt)
    );

  const map = new Map<string, CollectedBy>();
  for (const r of rows) {
    if (!r.requestItemId) {
      continue;
    }
    // The account wins over the stored values, which cover a collector who
    // had no account. Same reconciliation as every other joined read, so it
    // comes from the Hold module rather than being restated here.
    const hold = holdFromJoinedRow(
      {
        currentHolderId: r.holderId,
        currentHolderEmail: r.holderEmail,
        currentHolderLabel: null,
        currentHolderName: r.holderName,
        currentHolderProgram: null,
      },
      { accountEmail: r.accountEmail, accountName: r.accountName }
    );
    map.set(r.requestItemId, {
      id: r.holderId,
      email: holdEmail(hold),
      name: holdName(hold),
    });
  }
  return map;
}

export async function listInventoryRequestsAs(
  viewer: Viewer,
  data: InventoryRequestQueueFilter
) {
  assertStaff(viewer);
  // No lazy overdue trigger here: notifications are for the requester, not
  // staff, and a global scan on every queue read is wasteful. The notification
  // fires when the requester reads /my/items.
  const statusFilter =
    data.status === "all"
      ? undefined
      : eq(inventoryRequestItems.status, data.status);
  // Free-text search spans what a staff member has in front of them when they
  // go looking: the thing requested, and who asked for it.
  const q = data.q.trim();
  const searchFilter = q
    ? or(
        ilike(inventoryItems.name, `%${q}%`),
        ilike(user.name, `%${q}%`),
        ilike(user.email, `%${q}%`)
      )
    : undefined;
  const conditions = [statusFilter, searchFilter].filter(Boolean);
  const rows = await db
    .select({
      line: inventoryRequestItems,
      item: inventoryItems,
      request: inventoryRequests,
      requesterEmail: user.email,
      requesterName: user.name,
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
    .innerJoin(user, eq(inventoryRequests.userId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(inventoryRequests.createdAt));

  const collected = await collectedByForRequestItems(
    rows.map((r) => r.line.id)
  );
  const enriched = rows.map((r) => ({
    ...r,
    collectedBy: collected.get(r.line.id) ?? null,
  }));

  // One row per request line. The queue used to group these into one card per
  // batch; the table needs the flat shape, and the batch fields ride along on
  // every line so a row can still say who asked and why.
  return enriched.map((r) => ({
    line: r.line,
    item: r.item,
    requestId: r.request.id,
    requester: {
      id: r.request.userId,
      email: r.requesterEmail,
      name: r.requesterName,
    },
    requestedAt: r.request.createdAt,
    note: r.request.note,
    collectedBy: r.collectedBy,
  }));
}

export async function listMyItemsForCurrentUser() {
  const viewer = await requireUser();
  return listMyItemsAs(viewer);
}

export async function listInventoryRequestsForCurrentUser(
  data: InventoryRequestQueueFilter
) {
  const viewer = await requireUser();
  return listInventoryRequestsAs(viewer, data);
}
