import { eq } from "drizzle-orm";
import type { db as Db } from "#/db";
import { db } from "#/db";
import {
  inventoryItemStatusHistory,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  notifications,
  user,
} from "#/db/schema";
import { type Hold, holdFromInput, holdToColumns } from "#/lib/hold";
import { notificationFor } from "#/lib/inventory-notifications";
import type { ItemStatus } from "#/lib/inventory-visibility";
import {
  assertTransitionAllowed,
  type RequestLineDecision,
  type RequestLineOutcome,
  resolveLineOutcome,
  type TransitionActor,
  type TransitionInput,
} from "#/lib/inventory-workflow";

export type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

/**
 * The statuses a request line can be in while an item still points at it.
 * The same pair filters the Active tab's request half in `listMyItemsAs`,
 * and the two have to agree: an item whose `current_request_item_id` names
 * a line outside this set falls out of the request half without being
 * picked up by the hold half, and the item disappears from the page.
 */
function isOpenRequestLine(status: string): boolean {
  return status === "pending" || status === "approved";
}

/**
 * A request line is only attachable to the item it was raised for, and only
 * while it is still open. Runs before the item is locked, matching the
 * line-then-item order `approveRequestItemAs` already takes; reversing it
 * would deadlock the two paths against each other.
 */
async function lockAttachableRequestLine(
  tx: Tx,
  requestItemId: string,
  itemId: string
) {
  const [line] = await tx
    .select({
      id: inventoryRequestItems.id,
      itemId: inventoryRequestItems.itemId,
      status: inventoryRequestItems.status,
    })
    .from(inventoryRequestItems)
    .where(eq(inventoryRequestItems.id, requestItemId))
    .for("update");
  if (!line) {
    throw new Error("Request line not found");
  }
  if (line.itemId !== itemId) {
    throw new Error("Request line belongs to a different item");
  }
  if (!isOpenRequestLine(line.status)) {
    throw new Error(`Request line is no longer open (${line.status})`);
  }
}

/**
 * Completes the (account, address) pair from whichever half the caller had,
 * the same way a project's proposerEmail resolves to a proposerId, and hands
 * the completed pair to the Hold constructor.
 *
 * An address supplied by the caller always wins over a supplied id, because
 * it is the address the hold was actually assigned to. Deriving the address
 * in the id-only direction is what keeps current_holder_email populated for
 * callers that never had one to give (approveRequestItemAs), which is what
 * makes "a person hold always has an address" true on every write path.
 *
 * Every branch goes through `holdFromInput`, so the rules about which fields
 * survive live in one place (`src/lib/hold.ts`) rather than being reapplied
 * here. In particular, dropping a typed name and program once an account
 * resolves is structural in the union rather than a pair of ternaries.
 */
async function resolveHold(tx: Tx, input: TransitionInput): Promise<Hold> {
  const loose = {
    label: input.holderLabel,
    name: input.holderName,
    program: input.holderProgram,
  };
  if (input.holderEmail) {
    const [match] = await tx
      .select({ id: user.id, name: user.name })
      .from(user)
      .where(eq(user.email, input.holderEmail));
    return holdFromInput(
      { ...loose, email: input.holderEmail },
      { accountId: match?.id ?? null, accountName: match?.name ?? null }
    );
  }
  if (input.holderId) {
    // The id may name an account row that no longer exists, in which case the
    // address comes back null and the hold is still an account hold. The Hold
    // constructor checks the account before the address for exactly this case.
    const [account] = await tx
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, input.holderId));
    return holdFromInput(
      { ...loose, email: account?.email ?? null },
      { accountId: input.holderId, accountName: account?.name ?? null }
    );
  }
  return holdFromInput(loose, { accountId: null, accountName: null });
}

/** The account behind a hold, when there is one. Notifications need an id. */
function holdAccountId(hold: Hold): string | null {
  return hold.kind === "account" ? hold.accountId : null;
}

/**
 * Single chokepoint for every item status change. Runs in a transaction,
 * writes one history row, syncs the item's current_holder_* columns and
 * current_request_item_id, and (when applicable) updates the linked
 * inventory_request_items row's lifecycle columns.
 *
 * Does NOT enforce ordering between statuses ("recommended lifecycle" is a
 * UI concern). DOES enforce role and data invariants, but no longer decides
 * what they are: `assertTransitionAllowed` in `#/lib/inventory-workflow` owns
 * every rule that can be settled without reading a row, and is called here
 * before a transaction is opened. What is left in this file are the rules
 * that need a locked row to mean anything.
 */
export async function transitionItem(
  viewer: TransitionActor,
  input: TransitionInput,
  externalTx?: Tx
) {
  assertTransitionAllowed(viewer, input);

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
  viewer: TransitionActor,
  input: TransitionInput
) {
  if (input.requestItemId) {
    await lockAttachableRequestLine(tx, input.requestItemId, input.itemId);
  }

  const hold = await resolveHold(tx, input);
  // The account is authoritative for anyone who has one, so a typed name or
  // program is dropped rather than stored alongside it and left to drift.
  // That rule now lives in the Hold union: the account case has nowhere to
  // put them.
  const holderColumns = holdToColumns(hold);

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
      ...holderColumns,
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
    // A release cannot carry requestItemId, but a decision names the line it
    // closed, and the audit row should say which line this transition was
    // about. Falling back to it keeps the link the reject and cancel paths
    // wrote before they came through here.
    requestItemId:
      input.requestItemId ?? input.lineDecision?.requestItemId ?? null,
    // The history row records the same five values under its own column
    // names, so it is fed from the same flattened hold rather than from a
    // second reading of the input. Two attributes of one person travelling by
    // two mechanisms is what let these fall out of sync before.
    holderId: holderColumns.currentHolderId,
    holderEmail: holderColumns.currentHolderEmail,
    holderLabel: holderColumns.currentHolderLabel,
    holderName: holderColumns.currentHolderName,
    holderProgram: holderColumns.currentHolderProgram,
  });

  // A decision names the line it was made about. If the item has since moved
  // on to someone else's line, the caller decided about a line this item no
  // longer holds, and writing the outcome anyway would close a stranger's
  // request with another student's review text.
  if (
    input.lineDecision &&
    input.lineDecision.requestItemId !== current.currentRequestItemId
  ) {
    throw new Error(
      "The request line this decision names is not the one the item is holding"
    );
  }

  let closed: ClosedLine | null = null;
  if (input.requestItemId) {
    await syncRequestItem(tx, input);
  } else if (current.currentRequestItemId) {
    // Item is leaving a hold context; close the line.
    closed = await closeRequestItemOnRelease(
      tx,
      current.currentRequestItemId,
      viewer.id,
      current.status,
      input.comment ?? null,
      input.lineDecision
    );
  }

  const notice = notificationFor(current, input, holdAccountId(hold), closed);
  if (notice) {
    await tx.insert(notifications).values(notice);
  }
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

/** What was written to the line, and who asked for it in the first place. */
interface ClosedLine {
  outcome: RequestLineOutcome;
  /** The account that submitted the request, when one was looked up. */
  requesterId: string | null;
}

/**
 * Closes the line an item was holding, and reports what it wrote so the
 * notification arm does not have to guess.
 */
async function closeRequestItemOnRelease(
  tx: Tx,
  requestItemId: string,
  actorId: string,
  prevStatus: ItemStatus,
  comment: string | null,
  decision: RequestLineDecision | null | undefined
): Promise<ClosedLine> {
  const lineStatus = resolveLineOutcome(decision, prevStatus);
  const now = new Date();

  let requesterId: string | null = null;
  if (lineStatus === "rejected") {
    // The same precondition rejectRequestItemAs has always enforced. Without
    // it a release could stamp "rejected" over an approved or returned line
    // and overwrite the approver's own review columns, erasing the decision
    // that actually happened.
    //
    // The requester is read here too, and not left to the notification arm to
    // infer. A denial belongs to whoever asked, which is a fact of the request
    // line; the item's current holder is a different question and can be a
    // different person, because staff can hand a still-pending item to a
    // teammate.
    const [line] = await tx
      .select({
        status: inventoryRequestItems.status,
        requesterId: inventoryRequests.userId,
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
      throw new Error("Only pending lines can be rejected");
    }
    requesterId = line.requesterId;
  }

  await tx
    .update(inventoryRequestItems)
    .set({
      status: lineStatus,
      closedAt: now,
      closedBy: actorId,
      closedReason: comment,
      updatedAt: now,
      // A rejection is a review decision, so it also fills the review columns.
      // The comment does double duty as the reason and the review note,
      // matching what the reject path wrote before it came through here.
      ...(lineStatus === "rejected"
        ? { reviewedAt: now, reviewedBy: actorId, reviewComment: comment }
        : {}),
    })
    .where(eq(inventoryRequestItems.id, requestItemId));
  return { outcome: lineStatus, requesterId };
}
