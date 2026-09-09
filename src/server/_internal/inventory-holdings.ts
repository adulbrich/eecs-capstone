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
  inventoryCustomLines,
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
  type MyCustomLineView,
  type MyRequestLineView,
  myCustomLineView,
  myRequestLineView,
  type StaffCustomLineView,
  staffCustomLineView,
} from "#/lib/inventory-visibility";
import { assertStaff, type Viewer } from "#/lib/viewer";
import {
  INVENTORY_CUSTOM_LINE_STATUSES,
  INVENTORY_REQUEST_ITEM_STATUSES,
  type ItemStatus,
} from "#/lib/vocabularies";
import type { InventoryRequestQueueFilter } from "../inventory";
import { getCartAs } from "./inventory-cart";
import { linkedItemsFor } from "./inventory-custom";
import { recordOverdueNotificationsAs } from "./inventory-overdue";

/**
 * One row of `/my/items`, carrying the group it belongs to.
 *
 * Four kinds, because four things can sit on a person's page: an item in the
 * borrow list, not yet submitted; a request line, open or closed, with the
 * envelope it arrived in denormalized onto it so the page can group by request
 * without a second lookup; a custom line, carrying its envelope the same way;
 * and a hold. A hold produced by fulfilling a custom line names that line in
 * `viaCustomLineId` and is placed directly after it, so the page can indent
 * it under the line rather than file it under "Assigned to you by staff".
 *
 * Only a hold carries the item as its subject, because only a hold has no
 * line. A request row carries its line plus the item's name and status: a
 * request's deadlines live on the line, and letting it carry the item's too
 * would put two different `pickupBy` values on one object (see
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
  | {
      kind: "custom";
      line: MyCustomLineView;
      note: string | null;
      requestId: string;
      requestedAt: Date;
    }
  | { item: HoldItemView; kind: "hold"; viaCustomLineId: string | null };

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
  const [cart, openLines, holds, closedLines, customLines] = await Promise.all([
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
      )
      // Deterministic within a request: lines of one borrow list share a
      // createdAt, and a heap scan returns updated rows in a new place.
      .orderBy(inventoryRequestItems.createdAt, inventoryRequestItems.id),
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
    db
      .select({ line: inventoryCustomLines, request: inventoryRequests })
      .from(inventoryCustomLines)
      .innerJoin(
        inventoryRequests,
        eq(inventoryCustomLines.requestId, inventoryRequests.id)
      )
      .where(eq(inventoryRequests.userId, viewer.id))
      .orderBy(inventoryCustomLines.createdAt, inventoryCustomLines.id),
  ]);

  const lines = [...openLines, ...closedLines];
  // The items each custom line produced, to file the holds it created under
  // it. Read after the holds, so a hold and its line come from one moment.
  const linked = await linkedItemsFor(customLines.map((row) => row.line.id));
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

  const holdRowsById = new Map(
    holds.map((row) => [
      row.item.id,
      {
        kind: "hold" as const,
        item: holdItemView(row.item),
        viaCustomLineId: null as string | null,
      },
    ])
  );
  // A hold created by a fulfillment is filed under the line that produced it
  // and taken out of the staff-holds group. The join table is what makes the
  // distinction available: mechanically the hold is an ordinary staff one.
  const holdsViaLine = new Map<
    string,
    Extract<MyItemsRow, { kind: "hold" }>[]
  >();
  for (const [lineId, items] of linked) {
    for (const item of items) {
      const hold = holdRowsById.get(item.id);
      if (!hold) {
        continue;
      }
      hold.viaCustomLineId = lineId;
      holdRowsById.delete(item.id);
      holdsViaLine.set(lineId, [...(holdsViaLine.get(lineId) ?? []), hold]);
    }
  }

  // One run of rows per request, newest request first, the lines inside it
  // in the order they were carted. Grouped here rather than by the page, so
  // a request whose lines straddle open and closed still arrives contiguous.
  // An envelope holds one kind of line, so a bucket is all item lines or all
  // custom lines.
  interface Envelope {
    createdAt: Date;
    id: string;
    note: string | null;
  }
  const byRequest = new Map<
    string,
    { request: Envelope; rows: MyItemsRow[]; sortKeys: number[] }
  >();
  const fileUnder = (request: Envelope, at: Date, ...rows: MyItemsRow[]) => {
    const bucket = byRequest.get(request.id) ?? {
      request,
      rows: [],
      sortKeys: [],
    };
    for (const row of rows) {
      bucket.rows.push(row);
      bucket.sortKeys.push(at.getTime());
    }
    byRequest.set(request.id, bucket);
  };
  for (const row of lines) {
    fileUnder(row.request, row.line.createdAt, {
      kind: "request",
      requestId: row.request.id,
      requestedAt: row.request.createdAt,
      note: row.request.note,
      collectedBy: collectedByForViewer(row.line.id),
      itemName: row.item.name,
      itemStatus: row.item.status,
      line: myRequestLineView(row.line),
    });
  }
  for (const row of customLines) {
    fileUnder(
      row.request,
      row.line.createdAt,
      {
        kind: "custom",
        requestId: row.request.id,
        requestedAt: row.request.createdAt,
        note: row.request.note,
        line: myCustomLineView(row.line),
      },
      ...(holdsViaLine.get(row.line.id) ?? [])
    );
  }
  const requestRows = [...byRequest.values()]
    .sort(
      (a, b) => b.request.createdAt.getTime() - a.request.createdAt.getTime()
    )
    .flatMap((bucket) =>
      // A stable sort by line date keeps a hold right after its line, since
      // both were filed with the line's own timestamp.
      bucket.rows
        .map((row, index) => ({ row, key: bucket.sortKeys[index], index }))
        .sort((a, b) => a.key - b.key || a.index - b.index)
        .map((entry) => entry.row)
    );

  const holdRows = [...holdRowsById.values()].sort(compareByDeadline);

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

/** Who did something, as the queue names them: a name, else an address. */
interface Person {
  email: string;
  name: string | null;
}

/**
 * One row of the staff queue: a request line with its item, or a custom line
 * with the items it produced. The envelope rides on every row so the table
 * can group by request, and `kind` is what the page's one map switches on.
 */
export type QueueRow = {
  closer: Person | null;
  note: string | null;
  requestId: string;
  requestedAt: Date;
  requester: { email: string; id: string; name: string | null };
  reviewer: Person | null;
} & (
  | {
      collectedBy: CollectedBy | null;
      item: typeof inventoryItems.$inferSelect;
      kind: "item";
      line: typeof inventoryRequestItems.$inferSelect;
    }
  | {
      items: { id: string; name: string; status: string }[];
      kind: "custom";
      line: StaffCustomLineView;
    }
);

function person(email: string | null, name: string | null): Person | null {
  return email ? { email, name } : null;
}

export async function listInventoryRequestsAs(
  viewer: Viewer,
  data: InventoryRequestQueueFilter
): Promise<QueueRow[]> {
  assertStaff(viewer);
  // No lazy overdue trigger here: notifications are for the requester, not
  // staff, and a global scan on every queue read is wasteful. The notification
  // fires when the requester reads /my/items.
  //
  // One status filter over two vocabularies. A status only one kind has
  // filters to that kind: the other kind's query is skipped rather than
  // asked for a value its column cannot hold.
  const wantsItemLines =
    data.status === "all" ||
    (INVENTORY_REQUEST_ITEM_STATUSES as readonly string[]).includes(
      data.status
    );
  const wantsCustomLines =
    data.status === "all" ||
    (INVENTORY_CUSTOM_LINE_STATUSES as readonly string[]).includes(data.status);
  // Free-text search spans what a staff member has in front of them when they
  // go looking: the thing requested, and who asked for it.
  const q = data.q.trim();
  const requesterMatches = q
    ? [ilike(user.name, `%${q}%`), ilike(user.email, `%${q}%`)]
    : [];
  // `user` three times in one query: the requester, and the two staff
  // members the line sheet's timeline names. Left joins, because a pending
  // line has neither and a cancelled one has no reviewer.
  const reviewer = alias(user, "reviewer");
  const closer = alias(user, "closer");
  const people = {
    requesterEmail: user.email,
    requesterName: user.name,
    reviewerEmail: reviewer.email,
    reviewerName: reviewer.name,
    closerEmail: closer.email,
    closerName: closer.name,
  };

  const itemConditions = [
    data.status === "all"
      ? undefined
      : eq(
          inventoryRequestItems.status,
          data.status as (typeof INVENTORY_REQUEST_ITEM_STATUSES)[number]
        ),
    q
      ? or(ilike(inventoryItems.name, `%${q}%`), ...requesterMatches)
      : undefined,
  ].filter(Boolean);
  const itemRows = wantsItemLines
    ? await db
        .select({
          line: inventoryRequestItems,
          item: inventoryItems,
          request: inventoryRequests,
          ...people,
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
        .where(itemConditions.length ? and(...itemConditions) : undefined)
        .orderBy(desc(inventoryRequests.createdAt))
    : [];

  const customConditions = [
    data.status === "all"
      ? undefined
      : eq(
          inventoryCustomLines.status,
          data.status as (typeof INVENTORY_CUSTOM_LINE_STATUSES)[number]
        ),
    q
      ? or(ilike(inventoryCustomLines.name, `%${q}%`), ...requesterMatches)
      : undefined,
  ].filter(Boolean);
  const customRows = wantsCustomLines
    ? await db
        .select({
          line: inventoryCustomLines,
          request: inventoryRequests,
          ...people,
        })
        .from(inventoryCustomLines)
        .innerJoin(
          inventoryRequests,
          eq(inventoryCustomLines.requestId, inventoryRequests.id)
        )
        .innerJoin(user, eq(inventoryRequests.userId, user.id))
        .leftJoin(reviewer, eq(inventoryCustomLines.reviewedBy, reviewer.id))
        .leftJoin(closer, eq(inventoryCustomLines.closedBy, closer.id))
        .where(customConditions.length ? and(...customConditions) : undefined)
        .orderBy(desc(inventoryRequests.createdAt))
    : [];

  const [collected, linked] = await Promise.all([
    collectedByForRequestItems(itemRows.map((r) => r.line.id)),
    linkedItemsFor(customRows.map((r) => r.line.id)),
  ]);

  const envelope = (
    r: (typeof itemRows)[number] | (typeof customRows)[number]
  ) => ({
    requestId: r.request.id,
    requester: {
      id: r.request.userId,
      email: r.requesterEmail,
      name: r.requesterName,
    },
    requestedAt: r.request.createdAt,
    note: r.request.note,
    reviewer: person(r.reviewerEmail, r.reviewerName),
    closer: person(r.closerEmail, r.closerName),
  });

  // One row per line of either kind. The batch fields ride along on every
  // line so a row can still say who asked and why, and so the table can
  // group. Newest request first across both kinds.
  const rows: QueueRow[] = [
    ...itemRows.map(
      (r): QueueRow => ({
        ...envelope(r),
        kind: "item",
        line: r.line,
        item: r.item,
        collectedBy: collected.get(r.line.id) ?? null,
      })
    ),
    ...customRows.map(
      (r): QueueRow => ({
        ...envelope(r),
        kind: "custom",
        line: staffCustomLineView(r.line),
        items: linked.get(r.line.id) ?? [],
      })
    ),
  ];
  return rows.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());
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
