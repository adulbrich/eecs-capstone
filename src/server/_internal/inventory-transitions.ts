import { eq } from "drizzle-orm";
import type { db as Db } from "#/db";
import { db } from "#/db";
import {
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  notifications,
  user,
} from "#/db/schema";

export type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

export type ItemStatus =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance"
  | "retired";

export interface TransitionInput {
  comment?: string | null;
  dueAt?: Date | null;
  /** Assigns the hold to an address, with or without a matching account. */
  holderEmail?: string | null;
  holderId?: string | null;
  holderLabel?: string | null;
  itemId: string;
  nextStatus: ItemStatus;
  pickupBy?: Date | null;
  requestItemId?: string | null;
}

interface Viewer {
  id: string;
  role?: string | null | undefined;
}

function assertStaff(viewer: Viewer) {
  if (viewer.role !== "admin" && viewer.role !== "instructor") {
    throw new Error("Forbidden");
  }
}

function validateInvariants(input: TransitionInput) {
  const {
    nextStatus,
    holderId,
    holderEmail,
    holderLabel,
    requestItemId,
    pickupBy,
    dueAt,
  } = input;

  switch (nextStatus) {
    case "available":
    case "maintenance":
    case "retired":
      if (holderId || holderEmail || holderLabel || requestItemId) {
        throw new Error(
          `Cannot set holder or request on transition to ${nextStatus}`
        );
      }
      if (pickupBy || dueAt) {
        throw new Error(
          `pickupBy / dueAt not allowed on transition to ${nextStatus}`
        );
      }
      return;
    case "requested":
      if (!(requestItemId && holderId) || holderEmail || holderLabel) {
        throw new Error(
          "requested status requires requestItemId + holderId, no email or label"
        );
      }
      return;
    case "reserved":
    case "checked_out": {
      // A request line is optional: staff reserve or check out walk-in items
      // that were never carted, and those holds have no line to attach to.
      const holders = [holderId, holderEmail, holderLabel].filter(Boolean);
      if (holders.length !== 1) {
        throw new Error(
          `${nextStatus} requires exactly one of holderId, holderEmail or holderLabel`
        );
      }
      if (nextStatus === "checked_out" && !dueAt) {
        throw new Error("checked_out requires dueAt");
      }
      return;
    }
    default:
      return;
  }
}

/**
 * Links an email-assigned hold to an account when one already exists, the same
 * way a project's proposerEmail resolves to a proposerId. Without this the
 * holder would never be notified, even though they can sign in.
 */
async function resolveHolderId(
  tx: Tx,
  input: TransitionInput
): Promise<string | null> {
  if (input.holderId) {
    return input.holderId;
  }
  if (!input.holderEmail) {
    return null;
  }
  const [match] = await tx
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, input.holderEmail));
  return match?.id ?? null;
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
export async function transitionItem(
  viewer: Viewer,
  input: TransitionInput,
  externalTx?: Tx
) {
  assertStaff(viewer);
  validateInvariants(input);

  // If the caller already has an open transaction (e.g. approveRequestItemAs
  // locks the request line before calling here), reuse it instead of opening
  // a fresh one. Drizzle's nested db.transaction would otherwise run on a
  // separate connection and break atomicity.
  if (externalTx) {
    return await transitionItemInTx(externalTx, viewer, input);
  }
  return await db.transaction(async (tx) =>
    transitionItemInTx(tx, viewer, input)
  );
}

async function transitionItemInTx(
  tx: Tx,
  viewer: Viewer,
  rawInput: TransitionInput
) {
  // Every write below reads the resolved holder, so an email that matches an
  // account behaves exactly like a hold assigned through the user picker.
  const input: TransitionInput = {
    ...rawInput,
    holderId: await resolveHolderId(tx, rawInput),
  };

  const [current] = await tx
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, input.itemId))
    .for("update");

  if (!current) {
    throw new Error("Item not found");
  }

  // Guard: a fresh request can only attach to an item that is currently
  // free. Without this, callers could orphan an existing pending line by
  // overwriting current_request_item_id silently.
  if (input.nextStatus === "requested" && current.status !== "available") {
    throw new Error(
      `Cannot move item to requested from ${current.status}; release the existing hold first`
    );
  }

  await tx
    .update(inventoryItems)
    .set({
      status: input.nextStatus,
      currentHolderId: input.holderId ?? null,
      currentHolderEmail: input.holderEmail ?? null,
      currentHolderLabel: input.holderLabel ?? null,
      // Writing the hold's dates here on every transition means releasing an
      // item clears them for free, with no separate reset path.
      currentPickupBy: input.pickupBy ?? null,
      currentDueAt: input.dueAt ?? null,
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
    // Only an address that matched no account falls back to the label column:
    // once holderId is resolved the row must look like every other
    // account-backed hold, or the history list would render the raw email
    // where it shows an account everywhere else.
    holderLabel:
      input.holderLabel ??
      (input.holderId ? null : (input.holderEmail ?? null)),
  });

  if (input.requestItemId) {
    await syncRequestItem(tx, input);
  } else if (current.currentRequestItemId) {
    // Item is leaving a hold context; close the line.
    await closeRequestItemOnRelease(
      tx,
      current.currentRequestItemId,
      viewer.id,
      current.status,
      input.comment ?? null
    );
  }

  await maybeNotify(tx, current, input);
}

async function syncRequestItem(tx: Tx, input: TransitionInput) {
  // biome-ignore lint/style/noNonNullAssertion: syncRequestItem only runs for request-linked transitions
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
  prevStatus: ItemStatus,
  comment: string | null
) {
  // Fulfillment ended in the user's hands then came back: returned.
  // Otherwise (reserved abandoned, sent to maintenance/retired before pickup): cancelled.
  const lineStatus = prevStatus === "checked_out" ? "returned" : "cancelled";
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
  prev: {
    id: string;
    name: string;
    status: ItemStatus;
    currentHolderId: string | null;
    currentRequestItemId: string | null;
  },
  input: TransitionInput
) {
  // Identify a "release-from-hold" path: no new request context provided AND
  // the item was held by someone. The original holder is then the recipient.
  // A walk-in hold has no request line, so testing only for one would silently
  // drop the return notification for every staff-assigned checkout.
  const isReleaseFromHold =
    !input.requestItemId &&
    (!!prev.currentRequestItemId || !!prev.currentHolderId);

  const recipientId =
    input.holderId ?? (isReleaseFromHold ? prev.currentHolderId : null);
  if (!recipientId) {
    return;
  }

  switch (input.nextStatus) {
    case "reserved": {
      const title = input.pickupBy
        ? `Reserved: ${prev.name}. Pick up by ${formatDate(input.pickupBy)}.`
        : `Reserved: ${prev.name}.`;
      await tx.insert(notifications).values({
        userId: recipientId,
        type: "inventory_request_approved",
        title,
        message: `Your request for ${prev.name} was approved.`,
        link: "/my/items?tab=active",
      });
      return;
    }
    case "checked_out": {
      await tx.insert(notifications).values({
        userId: recipientId,
        type: "inventory_item_checked_out",
        title: `Checked out: ${prev.name}. Due ${formatDate(input.dueAt)}.`,
        message: `${prev.name} is now in your hands.`,
        link: "/my/items?tab=active",
      });
      return;
    }
    case "available":
    case "maintenance":
    case "retired": {
      if (!isReleaseFromHold) {
        return;
      }
      if (prev.status === "checked_out" && input.nextStatus === "available") {
        await tx.insert(notifications).values({
          userId: recipientId,
          type: "inventory_item_returned",
          title: `Returned: ${prev.name}`,
          message: `Thanks for returning ${prev.name}.`,
          link: `/inventory/${prev.id}`,
        });
      } else {
        await tx.insert(notifications).values({
          userId: recipientId,
          type: "inventory_request_closed",
          title: `Request closed: ${prev.name}`,
          message:
            input.comment ??
            `Your request for ${prev.name} was closed by staff.`,
          link: "/my/items?tab=history",
        });
      }
      return;
    }
    default:
      return;
  }
}

function formatDate(d: Date | null | undefined): string {
  if (!d) {
    return "soon";
  }
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}
