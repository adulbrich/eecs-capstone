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
  /**
   * An already-resolved account, supplied only by an internal caller that
   * already has one. Today that means approveRequestItemAs, passing the
   * requester's id. submitCartAs performs its requested transition inline and
   * never reaches here at all. Staff cannot assign a hold this way, because
   * transitionSchema does not accept a holder id. The address is derived from
   * the id, so the column invariant holds on this path too.
   */
  holderId?: string | null;
  holderLabel?: string | null;
  /** Describes a holder with no account. Discarded when one is resolved. */
  holderName?: string | null;
  holderProgram?: string | null;
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
    holderName,
    holderProgram,
    requestItemId,
    pickupBy,
    dueAt,
  } = input;

  switch (nextStatus) {
    case "available":
    case "maintenance":
    case "retired":
      if (
        holderId ||
        holderEmail ||
        holderLabel ||
        holderName ||
        holderProgram ||
        requestItemId
      ) {
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
      // A hold is on a person or on a thing, never both and never neither.
      // An id and an address both identify the same person, so they count as
      // one; name and program are attributes of that person, not a third
      // identity, and are excluded from the test entirely.
      const onAPerson = Boolean(holderId || holderEmail);
      const onAThing = Boolean(holderLabel);
      if (onAPerson === onAThing) {
        throw new Error(
          `${nextStatus} requires either a holder email or a holder label, not both and not neither`
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

interface ResolvedHolder {
  email: string | null;
  id: string | null;
}

/**
 * Completes the (account, address) pair from whichever half the caller had,
 * the same way a project's proposerEmail resolves to a proposerId.
 *
 * An address supplied by the caller always wins over a supplied id, because
 * it is the address the hold was actually assigned to. Deriving the address
 * in the id-only direction is what keeps current_holder_email populated for
 * callers that never had one to give (approveRequestItemAs), which is what
 * makes "a person hold always has an address" true on every write path.
 */
async function resolveHolder(
  tx: Tx,
  input: TransitionInput
): Promise<ResolvedHolder> {
  if (input.holderEmail) {
    const [match] = await tx
      .select({ id: user.id })
      .from(user)
      .where(eq(user.email, input.holderEmail));
    return { email: input.holderEmail, id: match?.id ?? null };
  }
  if (input.holderId) {
    const [account] = await tx
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, input.holderId));
    return { email: account?.email ?? null, id: input.holderId };
  }
  return { email: null, id: null };
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
  input: TransitionInput
) {
  const holder = await resolveHolder(tx, input);
  // The account is authoritative for anyone who has one, so a typed name or
  // program is dropped rather than stored alongside it and left to drift.
  const holderName = holder.id ? null : (input.holderName ?? null);
  const holderProgram = holder.id ? null : (input.holderProgram ?? null);

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
      currentHolderId: holder.id,
      currentHolderEmail: holder.email,
      currentHolderLabel: input.holderLabel ?? null,
      currentHolderName: holderName,
      currentHolderProgram: holderProgram,
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
    holderId: holder.id,
    holderEmail: holder.email,
    holderLabel: input.holderLabel ?? null,
    holderName,
    holderProgram,
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

  await maybeNotify(tx, current, input, holder.id);
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
  input: TransitionInput,
  holderId: string | null
) {
  // Identify a "release-from-hold" path: no new request context provided AND
  // the item was held by someone. The original holder is then the recipient.
  // A walk-in hold has no request line, so testing only for one would silently
  // drop the return notification for every staff-assigned checkout.
  const isReleaseFromHold =
    !input.requestItemId &&
    (!!prev.currentRequestItemId || !!prev.currentHolderId);

  const recipientId =
    holderId ?? (isReleaseFromHold ? prev.currentHolderId : null);
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
