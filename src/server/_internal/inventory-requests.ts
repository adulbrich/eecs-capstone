import { eq } from "drizzle-orm";
import { db } from "#/db";
import {
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { assertStaff, type Viewer } from "#/lib/viewer";
import type { Tx } from "./inventory-transitions";

const DEFAULT_PICKUP_DAYS = 7;

/** Seven days out. Shared with the fulfill path in `inventory-custom.ts`. */
export function defaultPickupBy(): Date {
  return new Date(Date.now() + DEFAULT_PICKUP_DAYS * 86_400_000);
}

/**
 * Approves one pending line inside an open transaction: locks the line,
 * stamps the review columns and hands the item to `transitionItem`, which
 * flips the line to `approved` under the same lock.
 *
 * Line first, then the item inside `transitionItem`. That order is shared
 * with `lockAttachableRequestLine`, and inverting it deadlocks the two paths
 * against each other (see `docs/QUIRKS.md`, Inventory).
 */
async function approveLineInTx(
  tx: Tx,
  viewer: NonNullable<Viewer>,
  requestItemId: string,
  pickupBy: Date
) {
  const { transitionItem } = await import("./inventory-transitions");
  // Lock the line before reading and updating it so a concurrent cancel
  // cannot move it out of 'pending' between this read and the transition.
  const [line] = await tx
    .select({
      id: inventoryRequestItems.id,
      itemId: inventoryRequestItems.itemId,
      requesterId: inventoryRequests.userId,
      status: inventoryRequestItems.status,
    })
    .from(inventoryRequestItems)
    .innerJoin(
      inventoryRequests,
      eq(inventoryRequestItems.requestId, inventoryRequests.id)
    )
    .where(eq(inventoryRequestItems.id, requestItemId))
    .for("update");
  if (!line) {
    throw new Error("Request line not found");
  }
  if (line.status !== "pending") {
    // The name is read on the refusal path only, and without a lock, so the
    // happy path takes no item lock before transitionItem does.
    const [item] = await tx
      .select({ name: inventoryItems.name })
      .from(inventoryItems)
      .where(eq(inventoryItems.id, line.itemId));
    throw new Error(`${item?.name ?? "This item"} is no longer pending`);
  }
  await tx
    .update(inventoryRequestItems)
    .set({
      reviewedBy: viewer.id,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(inventoryRequestItems.id, requestItemId));
  // Pass the open transaction so transitionItem joins the same atomic
  // unit; syncRequestItem will flip the line to 'approved' under the
  // same lock we already hold.
  await transitionItem(
    viewer,
    {
      itemId: line.itemId,
      nextStatus: "reserved",
      requestItemId: line.id,
      holderId: line.requesterId,
      pickupBy,
    },
    tx
  );
}

export async function approveRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; pickupBy: Date | null }
) {
  assertStaff(viewer);
  const pickupBy = data.pickupBy ?? defaultPickupBy();
  return await db.transaction(async (tx) => {
    await approveLineInTx(tx, viewer, data.requestItemId, pickupBy);
    return { ok: true as const };
  });
}

/**
 * Approves every named line with one pickup date, or none of them.
 *
 * The ids are the lines the dialog listed, which is what staff confirmed. A
 * line that has since left `pending` fails the whole batch and names its
 * item, rather than being skipped: what staff saw is what gets approved.
 *
 * Iterated in ascending id order whatever order the caller sent, so two
 * staff running overlapping batches wait on each other instead of each
 * holding a line the other wants. Each line then locks its item inside
 * `transitionItem`, the same line-then-item order as the single-line path.
 */
export async function approveRequestLinesAs(
  viewer: Viewer,
  data: { requestItemIds: string[]; pickupBy: Date | null }
) {
  assertStaff(viewer);
  const ids = [...new Set(data.requestItemIds)].sort();
  if (ids.length === 0) {
    throw new Error("No lines to approve");
  }
  // One date for the batch: a fallback computed per line would drift by
  // milliseconds across the group.
  const pickupBy = data.pickupBy ?? defaultPickupBy();
  return await db.transaction(async (tx) => {
    for (const id of ids) {
      await approveLineInTx(tx, viewer, id, pickupBy);
    }
    return { approved: ids };
  });
}

export async function rejectRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; reviewComment: string }
) {
  assertStaff(viewer);
  if (!data.reviewComment.trim()) {
    throw new Error("Reject reason required");
  }
  return await db.transaction(async (tx) => {
    // Locks the line and reads the item it belongs to. The requester is not
    // read here any more: transitionItem looks it up when it closes the line,
    // so that the denial reaches whoever asked even on a path that did not
    // come through this function.
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        status: inventoryRequestItems.status,
      })
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) {
      throw new Error("Request line not found");
    }
    if (line.status !== "pending") {
      throw new Error("Only pending lines can be rejected");
    }
    // The release, the line close, the history row and the denial notice all
    // happen inside transitionItem now. This function keeps only what is its
    // own: who may reject, and which line is eligible.
    const { transitionItem } = await import("./inventory-transitions");
    await transitionItem(
      viewer,
      {
        itemId: line.itemId,
        nextStatus: "available",
        comment: data.reviewComment,
        lineDecision: { outcome: "rejected", requestItemId: line.id },
      },
      tx
    );
    return { ok: true as const };
  });
}

export async function cancelRequestItemAs(
  viewer: Viewer,
  data: { requestItemId: string; note: string | null }
) {
  if (!viewer) {
    throw new Error("Sign in required");
  }
  return await db.transaction(async (tx) => {
    const [line] = await tx
      .select({
        id: inventoryRequestItems.id,
        itemId: inventoryRequestItems.itemId,
        status: inventoryRequestItems.status,
        requesterId: inventoryRequests.userId,
      })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id)
      )
      .where(eq(inventoryRequestItems.id, data.requestItemId))
      .for("update");
    if (!line) {
      throw new Error("Request line not found");
    }
    if (line.requesterId !== viewer.id) {
      throw new Error("Only the requester can cancel");
    }
    if (line.status !== "pending" && line.status !== "approved") {
      throw new Error("Line is not in a cancellable state");
    }
    const [item] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, line.itemId))
      .for("update");
    if (item.status === "checked_out") {
      throw new Error("Cannot cancel after checkout");
    }
    // self_cancel is what lets a requester past the staff gate, and it is the
    // reason no notification is emitted: the only person to tell is the one
    // who just clicked the button.
    const { transitionItem } = await import("./inventory-transitions");
    await transitionItem(
      viewer,
      {
        itemId: line.itemId,
        nextStatus: "available",
        comment: data.note,
        authority: "self_cancel",
        lineDecision: { outcome: "cancelled", requestItemId: line.id },
      },
      tx
    );
    return { ok: true as const };
  });
}

export async function approveRequestItemForCurrentUser(data: {
  requestItemId: string;
  pickupBy: Date | null;
}) {
  const viewer = await requireUser();
  return approveRequestItemAs(viewer, data);
}

export async function approveRequestLinesForCurrentUser(data: {
  requestItemIds: string[];
  pickupBy: Date | null;
}) {
  const viewer = await requireUser();
  return approveRequestLinesAs(viewer, data);
}

export async function rejectRequestItemForCurrentUser(data: {
  requestItemId: string;
  reviewComment: string;
}) {
  const viewer = await requireUser();
  return rejectRequestItemAs(viewer, data);
}

export async function cancelRequestItemForCurrentUser(data: {
  requestItemId: string;
  note: string | null;
}) {
  const viewer = await requireUser();
  return cancelRequestItemAs(viewer, data);
}
