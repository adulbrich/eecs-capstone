import { eq, inArray } from "drizzle-orm";
import { db } from "#/db";
import {
  inventoryCustomLineItems,
  inventoryCustomLines,
  inventoryItems,
  inventoryRequests,
  notifications,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import {
  assertCustomLineTransition,
  assertSourcingNoteEditable,
} from "#/lib/inventory-custom-workflow";
import {
  customLineNotification,
  type InventoryNotice,
  toNotificationRow,
} from "#/lib/inventory-notifications";
import type { Viewer } from "#/lib/viewer";
import { notifyInventoryByEmail } from "./inventory-emails";
import { defaultPickupBy } from "./inventory-requests";
import type { TransitionEmailOptions, Tx } from "./inventory-transitions";

/**
 * Custom requests: asks for equipment the inventory does not hold.
 *
 * Its own file rather than the eighth reason to open `inventory-requests.ts`,
 * following the split #104 made on these internals. The rules live in
 * `#/lib/inventory-custom-workflow`; what is here is what needs a locked
 * row: reading the line, writing its columns, linking the items.
 *
 * Every write here locks the line first. The fulfill path then locks its
 * items in ascending id order, which is a different rule from the batch
 * approve's line order and is recorded separately in `docs/QUIRKS.md`.
 */

export interface CustomLineInput {
  link: string | null;
  name: string;
  quantity: number;
  reason: string;
}

export async function submitCustomRequestAs(
  viewer: Viewer,
  data: { lines: CustomLineInput[]; note: string | null }
) {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  if (data.lines.length === 0) {
    throw new Error("A request needs at least one line");
  }
  return await db.transaction(async (tx) => {
    // The envelope is the same table a borrow list submits to, and holds
    // only custom lines: nothing here touches inventory_request_items.
    const [request] = await tx
      .insert(inventoryRequests)
      .values({ userId: viewer.id, note: data.note })
      .returning();
    const lines = await tx
      .insert(inventoryCustomLines)
      .values(
        data.lines.map((line) => ({
          requestId: request.id,
          name: line.name,
          reason: line.reason,
          quantity: line.quantity,
          link: line.link,
        }))
      )
      .returning({ id: inventoryCustomLines.id });
    // No notification: staff read the admin overview tile, which counts
    // envelopes with a pending line of either kind.
    return { requestId: request.id, lineIds: lines.map((line) => line.id) };
  });
}

/** The line and who asked for it, locked for the rest of the transaction. */
async function lockLine(tx: Tx, customLineId: string) {
  const [line] = await tx
    .select({
      id: inventoryCustomLines.id,
      name: inventoryCustomLines.name,
      requesterEmail: user.email,
      requesterId: inventoryRequests.userId,
      reviewedAt: inventoryCustomLines.reviewedAt,
      reviewedBy: inventoryCustomLines.reviewedBy,
      status: inventoryCustomLines.status,
    })
    .from(inventoryCustomLines)
    .innerJoin(
      inventoryRequests,
      eq(inventoryCustomLines.requestId, inventoryRequests.id)
    )
    .innerJoin(user, eq(inventoryRequests.userId, user.id))
    .where(eq(inventoryCustomLines.id, customLineId))
    .for("update");
  if (!line) {
    throw new Error("Custom line not found");
  }
  return line;
}

/** Writes the bell row a notice owes. The requester always has an account. */
async function insertNotice(tx: Tx, notice: InventoryNotice): Promise<void> {
  const row = toNotificationRow(notice);
  if (row) {
    await tx.insert(notifications).values(row);
  }
}

/**
 * The review columns are written once, on the first staff decision, and
 * never overwritten: sourcing then fulfilling would otherwise lose the date
 * the line left pending. The same rule `inventory_request_items` follows.
 */
function firstDecision(
  line: { reviewedAt: Date | null; reviewedBy: string | null },
  viewerId: string,
  now: Date
) {
  return {
    reviewedBy: line.reviewedBy ?? viewerId,
    reviewedAt: line.reviewedAt ?? now,
  };
}

export async function startSourcingCustomLineAs(
  viewer: Viewer,
  data: { customLineId: string; sourcingNote: string | null }
) {
  return await db.transaction(async (tx) => {
    const line = await lockLine(tx, data.customLineId);
    assertCustomLineTransition(viewer, line, "source");
    const now = new Date();
    await tx
      .update(inventoryCustomLines)
      .set({
        status: "sourcing",
        sourcingNote: data.sourcingNote,
        ...firstDecision(line, viewer.id, now),
      })
      .where(eq(inventoryCustomLines.id, line.id));
    await insertNotice(
      tx,
      customLineNotification("sourcing", {
        name: line.name,
        note: data.sourcingNote,
        requesterEmail: line.requesterEmail,
        requesterId: line.requesterId,
      })
    );
    return { ok: true as const };
  });
}

/**
 * The one endpoint that is not a transition. It rewrites `sourcing_note`
 * rather than appending: a status update's value dies when a fresher one
 * replaces it, and what was promised now and what happened in the end both
 * survive in their own columns.
 */
export async function updateSourcingNoteAs(
  viewer: Viewer,
  data: { customLineId: string; sourcingNote: string }
) {
  if (!data.sourcingNote.trim()) {
    throw new Error("A note is required");
  }
  return await db.transaction(async (tx) => {
    const line = await lockLine(tx, data.customLineId);
    assertSourcingNoteEditable(viewer, line);
    await tx
      .update(inventoryCustomLines)
      .set({ sourcingNote: data.sourcingNote })
      .where(eq(inventoryCustomLines.id, line.id));
    await insertNotice(
      tx,
      customLineNotification("sourcing_note", {
        name: line.name,
        note: data.sourcingNote,
        requesterEmail: line.requesterEmail,
        requesterId: line.requesterId,
      })
    );
    return { ok: true as const };
  });
}

export async function rejectCustomLineAs(
  viewer: Viewer,
  data: { customLineId: string; outcomeNote: string },
  opts?: TransitionEmailOptions
) {
  if (!data.outcomeNote.trim()) {
    throw new Error("Reject reason required");
  }
  const notice = await db.transaction(async (tx) => {
    const line = await lockLine(tx, data.customLineId);
    assertCustomLineTransition(viewer, line, "reject");
    const now = new Date();
    await tx
      .update(inventoryCustomLines)
      .set({
        status: "rejected",
        outcomeNote: data.outcomeNote,
        ...firstDecision(line, viewer.id, now),
        closedBy: viewer.id,
        closedAt: now,
      })
      .where(eq(inventoryCustomLines.id, line.id));
    const rejected = customLineNotification("rejected", {
      name: line.name,
      note: data.outcomeNote,
      requesterEmail: line.requesterEmail,
      requesterId: line.requesterId,
    });
    await insertNotice(tx, rejected);
    return rejected;
  });
  // After the commit, never inside it; swallows its own errors.
  await notifyInventoryByEmail(notice, opts?.send);
  return { ok: true as const };
}

/**
 * Links items that already exist to the line and, unless staff untick the
 * box, reserves each to the requester with a pickup deadline. Fulfill never
 * creates an item: `/inventory/new` owns that form.
 *
 * Items are locked in ascending id order and the whole thing fails, naming
 * the item, if any is not `available`. The reservation is an ordinary staff
 * hold through `transitionItem` (ADR-0004), silenced per item so the one
 * notification written below is the only one the requester gets.
 */
export async function fulfillCustomLineAs(
  viewer: Viewer,
  data: {
    customLineId: string;
    itemIds: string[];
    outcomeNote: string | null;
    pickupBy: Date | null;
    reserve: boolean;
  },
  opts?: TransitionEmailOptions
) {
  const itemIds = [...new Set(data.itemIds)].sort();
  if (itemIds.length === 0) {
    throw new Error("Link at least one item");
  }
  const { transitionItem } = await import("./inventory-transitions");
  const { notice, linked } = await db.transaction(async (tx) => {
    const line = await lockLine(tx, data.customLineId);
    assertCustomLineTransition(viewer, line, "fulfill");

    const items: { id: string; name: string }[] = [];
    for (const itemId of itemIds) {
      const [item] = await tx
        .select({
          id: inventoryItems.id,
          name: inventoryItems.name,
          status: inventoryItems.status,
        })
        .from(inventoryItems)
        .where(eq(inventoryItems.id, itemId))
        .for("update");
      if (!item) {
        throw new Error("Item not found");
      }
      if (item.status !== "available") {
        throw new Error(`${item.name} is not available`);
      }
      items.push({ id: item.id, name: item.name });
    }

    await tx
      .insert(inventoryCustomLineItems)
      .values(
        items.map((item) => ({ customLineId: line.id, itemId: item.id }))
      );

    const pickupBy = data.reserve ? (data.pickupBy ?? defaultPickupBy()) : null;
    if (pickupBy) {
      for (const item of items) {
        await transitionItem(
          viewer,
          {
            itemId: item.id,
            nextStatus: "reserved",
            holderId: line.requesterId,
            pickupBy,
            silent: true,
          },
          tx
        );
      }
    }

    const now = new Date();
    await tx
      .update(inventoryCustomLines)
      .set({
        status: "fulfilled",
        outcomeNote: data.outcomeNote,
        ...firstDecision(line, viewer.id, now),
        closedBy: viewer.id,
        closedAt: now,
      })
      .where(eq(inventoryCustomLines.id, line.id));
    const fulfilled = customLineNotification("fulfilled", {
      // Named in name order: the id order above is for the locks.
      items: [...items].sort((a, b) => a.name.localeCompare(b.name)),
      name: line.name,
      note: data.outcomeNote,
      pickupBy,
      requesterEmail: line.requesterEmail,
      requesterId: line.requesterId,
    });
    await insertNotice(tx, fulfilled);
    return { notice: fulfilled, linked: items.map((item) => item.id) };
  });
  // After the commit, never inside it; swallows its own errors. The per-item
  // reservations inside were silent, so this is the one email the requester
  // gets, matching the one bell row.
  await notifyInventoryByEmail(notice, opts?.send);
  return { ok: true as const, itemIds: linked };
}

/**
 * The requester's own transition. It leaves the review columns alone,
 * because nobody decided anything, and still writes `closed_by`, which is
 * what tells a cancel from a staff close on inspection. Nobody is told: the
 * only person to tell is the one who clicked.
 */
export async function cancelCustomLineAs(
  viewer: Viewer,
  data: { customLineId: string; outcomeNote: string | null }
) {
  return await db.transaction(async (tx) => {
    const line = await lockLine(tx, data.customLineId);
    assertCustomLineTransition(viewer, line, "cancel");
    await tx
      .update(inventoryCustomLines)
      .set({
        status: "cancelled",
        outcomeNote: data.outcomeNote,
        closedBy: viewer.id,
        closedAt: new Date(),
      })
      .where(eq(inventoryCustomLines.id, line.id));
    return { ok: true as const };
  });
}

/** The items a set of lines produced, for the two pages that show them. */
export async function linkedItemsFor(
  lineIds: string[]
): Promise<Map<string, { id: string; name: string; status: string }[]>> {
  const map = new Map<string, { id: string; name: string; status: string }[]>();
  if (lineIds.length === 0) {
    return map;
  }
  const rows = await db
    .select({
      customLineId: inventoryCustomLineItems.customLineId,
      id: inventoryItems.id,
      name: inventoryItems.name,
      status: inventoryItems.status,
    })
    .from(inventoryCustomLineItems)
    .innerJoin(
      inventoryItems,
      eq(inventoryCustomLineItems.itemId, inventoryItems.id)
    )
    .where(inArray(inventoryCustomLineItems.customLineId, lineIds))
    .orderBy(inventoryItems.name);
  for (const row of rows) {
    const bucket = map.get(row.customLineId) ?? [];
    bucket.push({ id: row.id, name: row.name, status: row.status });
    map.set(row.customLineId, bucket);
  }
  return map;
}

export async function submitCustomRequestForCurrentUser(data: {
  lines: CustomLineInput[];
  note: string | null;
}) {
  const viewer = await requireUser();
  return submitCustomRequestAs(viewer, data);
}

export async function startSourcingCustomLineForCurrentUser(data: {
  customLineId: string;
  sourcingNote: string | null;
}) {
  const viewer = await requireUser();
  return startSourcingCustomLineAs(viewer, data);
}

export async function updateSourcingNoteForCurrentUser(data: {
  customLineId: string;
  sourcingNote: string;
}) {
  const viewer = await requireUser();
  return updateSourcingNoteAs(viewer, data);
}

export async function rejectCustomLineForCurrentUser(data: {
  customLineId: string;
  outcomeNote: string;
}) {
  const viewer = await requireUser();
  return rejectCustomLineAs(viewer, data);
}

export async function fulfillCustomLineForCurrentUser(data: {
  customLineId: string;
  itemIds: string[];
  outcomeNote: string | null;
  pickupBy: Date | null;
  reserve: boolean;
}) {
  const viewer = await requireUser();
  return fulfillCustomLineAs(viewer, data);
}

export async function cancelCustomLineForCurrentUser(data: {
  customLineId: string;
  outcomeNote: string | null;
}) {
  const viewer = await requireUser();
  return cancelCustomLineAs(viewer, data);
}
