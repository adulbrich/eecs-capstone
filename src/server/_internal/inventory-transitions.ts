import { eq } from "drizzle-orm";
import { db } from "#/db";
import type { db as Db } from "#/db";
import {
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  notifications,
} from "#/db/schema";

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

export type ItemStatus =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance"
  | "retired";

export type TransitionInput = {
  itemId: string;
  nextStatus: ItemStatus;
  requestItemId?: string | null;
  holderId?: string | null;
  holderLabel?: string | null;
  pickupBy?: Date | null;
  dueAt?: Date | null;
  comment?: string | null;
};

type Viewer = { id: string; role?: string | null | undefined };

function assertStaff(viewer: Viewer) {
  if (viewer.role !== "admin" && viewer.role !== "instructor") {
    throw new Error("Forbidden");
  }
}

function validateInvariants(input: TransitionInput) {
  const { nextStatus, holderId, holderLabel, requestItemId, pickupBy, dueAt } =
    input;

  switch (nextStatus) {
    case "available":
    case "maintenance":
    case "retired":
      if (holderId || holderLabel || requestItemId) {
        throw new Error(
          `Cannot set holder or request on transition to ${nextStatus}`,
        );
      }
      if (pickupBy || dueAt) {
        throw new Error(
          `pickupBy / dueAt not allowed on transition to ${nextStatus}`,
        );
      }
      return;
    case "requested":
      if (!requestItemId || !holderId || holderLabel) {
        throw new Error(
          "requested status requires requestItemId + holderId, no label",
        );
      }
      return;
    case "reserved":
    case "checked_out": {
      if (!requestItemId) {
        throw new Error(`${nextStatus} requires requestItemId`);
      }
      const hasUser = !!holderId;
      const hasLabel = !!holderLabel;
      if (hasUser === hasLabel) {
        throw new Error(
          `${nextStatus} requires exactly one of holderId or holderLabel`,
        );
      }
      if (nextStatus === "checked_out" && !dueAt) {
        throw new Error("checked_out requires dueAt");
      }
      return;
    }
  }
}

/**
 * Single chokepoint for every item status change. Runs in a transaction,
 * writes one history row, syncs the item's current_holder_* columns and
 * current_request_item_id, and (when applicable) updates the linked
 * inventory_request_items row's lifecycle columns.
 *
 * Does NOT enforce ordering between statuses ("recommended lifecycle" is a
 * UI concern). DOES enforce role and data invariants.
 */
export async function transitionItem(viewer: Viewer, input: TransitionInput) {
  assertStaff(viewer);
  validateInvariants(input);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(inventoryItems)
      .where(eq(inventoryItems.id, input.itemId))
      .for("update");

    if (!current) throw new Error("Item not found");

    await tx
      .update(inventoryItems)
      .set({
        status: input.nextStatus,
        currentHolderId: input.holderId ?? null,
        currentHolderLabel: input.holderLabel ?? null,
        currentRequestItemId: input.requestItemId ?? null,
        updatedAt: new Date(),
      })
      .where(eq(inventoryItems.id, input.itemId));

    await tx.insert(inventoryItemStatusHistory).values({
      itemId: input.itemId,
      oldStatus: current.status,
      newStatus: input.nextStatus,
      changedBy: viewer.id,
      comment: input.comment ?? null,
      requestItemId: input.requestItemId ?? null,
      holderId: input.holderId ?? null,
      holderLabel: input.holderLabel ?? null,
    });

    if (input.requestItemId) {
      await syncRequestItem(tx, input);
    } else if (current.currentRequestItemId) {
      // Item is leaving a hold context; close the line.
      await closeRequestItemOnRelease(
        tx,
        current.currentRequestItemId,
        viewer.id,
        input.nextStatus,
        input.comment ?? null,
      );
    }

    await maybeNotify(tx, current, input);
  });
}

async function syncRequestItem(tx: Tx, input: TransitionInput) {
  const id = input.requestItemId!;
  switch (input.nextStatus) {
    case "reserved":
      await tx
        .update(inventoryRequestItems)
        .set({
          status: "approved",
          pickupBy: input.pickupBy ?? null,
          updatedAt: new Date(),
        })
        .where(eq(inventoryRequestItems.id, id));
      return;
    case "checked_out":
      await tx
        .update(inventoryRequestItems)
        .set({ dueAt: input.dueAt ?? null, updatedAt: new Date() })
        .where(eq(inventoryRequestItems.id, id));
      return;
    case "requested":
      // line was created by submitCart with status='pending'; no change.
      return;
    default:
      return;
  }
}

async function closeRequestItemOnRelease(
  tx: Tx,
  requestItemId: string,
  actorId: string,
  nextStatus: ItemStatus,
  comment: string | null,
) {
  const lineStatus =
    nextStatus === "available" || nextStatus === "maintenance"
      ? "returned"
      : "cancelled";
  await tx
    .update(inventoryRequestItems)
    .set({
      status: lineStatus,
      closedAt: new Date(),
      closedBy: actorId,
      closedReason: comment,
      updatedAt: new Date(),
    })
    .where(eq(inventoryRequestItems.id, requestItemId));
}

async function maybeNotify(
  tx: Tx,
  prev: { id: string; name: string; status: ItemStatus; currentHolderId: string | null },
  input: TransitionInput,
) {
  // Only notify a real user; ad-hoc labels do not receive notifications.
  const recipientId =
    input.holderId ??
    (input.nextStatus === "available" || input.nextStatus === "maintenance"
      ? prev.currentHolderId
      : null);
  if (!recipientId) return;

  switch (input.nextStatus) {
    case "reserved":
      await tx.insert(notifications).values({
        userId: recipientId,
        type: "inventory_request_approved",
        title: `Reserved: ${prev.name}. Pick up by ${formatDate(input.pickupBy)}.`,
        message: `Your request for ${prev.name} was approved.`,
        link: `/my/items?tab=active`,
      });
      return;
    case "checked_out":
      await tx.insert(notifications).values({
        userId: recipientId,
        type: "inventory_item_checked_out",
        title: `Checked out: ${prev.name}. Due ${formatDate(input.dueAt)}.`,
        message: `${prev.name} is now in your hands.`,
        link: `/my/items?tab=active`,
      });
      return;
    case "available":
      // Released from a hold; notify if there was a prior holder.
      if (prev.currentHolderId) {
        await tx.insert(notifications).values({
          userId: prev.currentHolderId,
          type: "inventory_item_returned",
          title: `Returned: ${prev.name}`,
          message: `Thanks for returning ${prev.name}.`,
          link: `/inventory/${prev.id}`,
        });
      }
      return;
    default:
      return;
  }
}

function formatDate(d: Date | null | undefined): string {
  if (!d) return "soon";
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
