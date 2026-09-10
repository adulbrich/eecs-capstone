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
import { alias } from "drizzle-orm/pg-core";
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
 * One row of `/my/items`, carrying the group it belongs to.
 *
 * Three kinds, because three things can sit on a person's page: an item in
 * the borrow list, not yet submitted; a request line, open or closed, with the
 * envelope it arrived in denormalized onto it so the page can group by request
 * without a second lookup; and a hold with no request line behind it.
 *
 * Only a hold carries the item as its subject, because only a hold has no
 * request line. A request row carries its line plus the item's name and
 * status: a request's deadlines live on the line, and letting it carry the
 * item's too would put two different `pickupBy` values on one object (see
 * `docs/QUIRKS.md`). A cart row carries the item's name and status the same
 * way, since it has no line at all.
 */
export type MyItemsRow =
  | { itemId: string; itemName: string; itemStatus: ItemStatus; kind: "cart" }
  | {
      collectedBy: CollectedBy | null;
      itemName: string;
      itemStatus: ItemStatus;
      kind: "request";
      line: MyRequestLineView;
      note: string | null;
      requestId: string;
      requestedAt: Date;
    }
  | { item: HoldItemView; kind: "hold" };

/** The closed lines the page shows, most recently closed first. */
const CLOSED_LINES_LIMIT = 50;

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

/**
 * Everything on a person's page, as one list in display order: the borrow
 * list, then one run of rows per submitted request, newest request first and
 * the lines inside it oldest first, then the holds staff assigned with no
 * request behind them, soonest deadline first. The page groups by `kind` and
 * `requestId` and renders this order as given, because nothing on it sorts.
 */
export async function listMyItemsAs(viewer: Viewer): Promise<MyItemsRow[]> {
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

  const lineSelection = {
    line: inventoryRequestItems,
    item: inventoryItems,
    request: inventoryRequests,
  };
  const [cart, openLines, holds, closedLines] = await Promise.all([
    getCartAs(viewer),
    db
      .select(lineSelection)
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
      ),
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
          // The status filter has to be the same one the open-lines query
          // above uses, or the two stop partitioning: an item pointing at a
          // closed line would be excluded here as a duplicate of a row that
          // query never returns, and would vanish from the page entirely.
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
      .select(lineSelection)
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
      .limit(CLOSED_LINES_LIMIT),
  ]);

  const lines = [...openLines, ...closedLines];
  const collected = await collectedByForRequestItems(
    lines.map((r) => r.line.id)
  );

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

  // One run of rows per request, newest request first, the lines inside it
  // in the order they were carted. Grouped here rather than by the page, so
  // a request whose lines straddle open and closed still arrives contiguous.
  const byRequest = new Map<string, typeof lines>();
  for (const row of lines) {
    const bucket = byRequest.get(row.request.id);
    if (bucket) {
      bucket.push(row);
    } else {
      byRequest.set(row.request.id, [row]);
    }
  }
  const requestRows = [...byRequest.values()]
    .sort(
      (a, b) =>
        b[0].request.createdAt.getTime() - a[0].request.createdAt.getTime()
    )
    .flatMap((group) =>
      group
        .sort((a, b) => a.line.createdAt.getTime() - b.line.createdAt.getTime())
        .map(
          (row): MyItemsRow => ({
            kind: "request",
            requestId: row.request.id,
            requestedAt: row.request.createdAt,
            note: row.request.note,
            collectedBy: collectedByForViewer(row.line.id),
            itemName: row.item.name,
            itemStatus: row.item.status,
            line: myRequestLineView(row.line),
          })
        )
    );

  const holdRows = holds
    .map(
      (row): Extract<MyItemsRow, { kind: "hold" }> => ({
        kind: "hold",
        item: holdItemView(row.item),
      })
    )
    .sort(compareByDeadline);

  return [
    ...cart.map(
      (row): MyItemsRow => ({
        kind: "cart",
        itemId: row.itemId,
        itemName: row.name,
        itemStatus: row.status,
      })
    ),
    ...requestRows,
    ...holdRows,
  ];
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
  // `user` three times in one query: the requester, and the two staff
  // members the line sheet's timeline names. Left joins, because a pending
  // line has neither and a cancelled one has no reviewer.
  const reviewer = alias(user, "reviewer");
  const closer = alias(user, "closer");
  const rows = await db
    .select({
      line: inventoryRequestItems,
      item: inventoryItems,
      request: inventoryRequests,
      requesterEmail: user.email,
      requesterName: user.name,
      reviewerEmail: reviewer.email,
      reviewerName: reviewer.name,
      closerEmail: closer.email,
      closerName: closer.name,
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
    .leftJoin(reviewer, eq(inventoryRequestItems.reviewedBy, reviewer.id))
    .leftJoin(closer, eq(inventoryRequestItems.closedBy, closer.id))
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
    reviewer: r.reviewerEmail
      ? { email: r.reviewerEmail, name: r.reviewerName }
      : null,
    closer: r.closerEmail ? { email: r.closerEmail, name: r.closerName } : null,
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
