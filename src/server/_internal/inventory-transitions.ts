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
import { type Hold, holdFromInput, holdToColumns } from "#/lib/hold";

export type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

export type ItemStatus =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance"
  | "retired";

/**
 * The non-staff authority a caller has already verified for itself.
 *
 * Absent means staff, and `assertStaff` runs exactly as it always has. These
 * two values are the only way past it, they are only reachable from an
 * internal caller, and each names the check its caller performed:
 * `self_cancel` means the caller confirmed the viewer owns the request line,
 * `self_request` means the viewer is submitting their own cart.
 *
 * `transitionSchema` in `src/server/inventory.ts` does not declare this field,
 * and `z.object().parse` strips unknown keys, so a client that posts
 * `authority` has it removed before it reaches here. Do not add it to that
 * schema: it is the whole staff gate for `transitionInventoryItem`, which
 * carries only `requireUser()` of its own.
 */
export type TransitionAuthority = "self_cancel" | "self_request";

/**
 * What a request line becomes when the item is released out from under it.
 *
 * Absent keeps the existing derivation, `returned` from a checkout and
 * `cancelled` otherwise. It is passed rather than derived because rejecting a
 * pending line and releasing a reserved item both end at `available` with a
 * comment, and nothing in the transition itself distinguishes them.
 */
export type RequestLineOutcome = "cancelled" | "rejected" | "returned";

/**
 * A decision about one specific request line.
 *
 * The line id travels with the outcome rather than beside it, and that is the
 * point. A release transition cannot carry `requestItemId` (validateInvariants
 * forbids it on the statuses a release targets), so without this the outcome
 * would land on whatever line the item happens to point at when the write
 * runs, which is not necessarily the line the caller locked and decided
 * about. Naming an outcome without naming its line is now unrepresentable,
 * and `transitionItemInTx` refuses a mismatch rather than writing to the
 * wrong student's record.
 */
export interface RequestLineDecision {
  outcome: RequestLineOutcome;
  requestItemId: string;
}

export interface TransitionInput {
  authority?: TransitionAuthority | null;
  comment?: string | null;
  dueAt?: Date | null;
  /** Assigns the hold to an address, with or without a matching account. */
  holderEmail?: string | null;
  /**
   * An already-resolved account, supplied only by an internal caller that
   * already has one: approveRequestItemAs passing the requester's id, and
   * submitCartAs passing the submitting student's. Staff cannot assign a hold
   * this way, because transitionSchema does not accept a holder id. The
   * address is derived from the id, so the column invariant holds here too.
   */
  holderId?: string | null;
  holderLabel?: string | null;
  /** Describes a holder with no account. Discarded when one is resolved. */
  holderName?: string | null;
  holderProgram?: string | null;
  itemId: string;
  lineDecision?: RequestLineDecision | null;
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

const SELF_SERVICE_AUTHORITIES: readonly TransitionAuthority[] = [
  "self_cancel",
  "self_request",
];

/** The one status each self-service authority is allowed to reach. */
const AUTHORITY_TARGET: Record<TransitionAuthority, ItemStatus> = {
  self_cancel: "available",
  self_request: "requested",
};

/**
 * Default deny. No authority means staff, which is every caller that existed
 * before self-service paths were routed through here, so their behavior is
 * unchanged. A named authority is accepted only if it is one this module
 * knows; an unrecognized string is rejected rather than waved through, so a
 * future typo fails closed.
 */
function assertAuthorized(viewer: Viewer, input: TransitionInput) {
  if (!input.authority) {
    assertStaff(viewer);
    return;
  }
  if (!SELF_SERVICE_AUTHORITIES.includes(input.authority)) {
    throw new Error("Forbidden");
  }
}

/** The statuses that release an item, and so can close the line it held. */
function isReleaseStatus(status: ItemStatus): boolean {
  return (
    status === "available" || status === "maintenance" || status === "retired"
  );
}

/**
 * The rules for the two fields that let a caller act outside the staff path.
 * They live here, beside every other cross-field rule in this module, rather
 * than in the callers that pass them. A caller naming its own authority must
 * not also get to decide what that authority is allowed to do.
 */
function validateSelfServiceAndDecision(input: TransitionInput) {
  // Each authority reaches exactly one status. A self-service caller releases
  // an item or requests one; it does not retire one, send one to maintenance,
  // or check one out to itself with a deadline of its choosing. Without this
  // an authority is a hole the size of every status.
  if (input.authority) {
    const allowed = AUTHORITY_TARGET[input.authority];
    if (input.nextStatus !== allowed) {
      throw new Error(
        `${input.authority} may only move an item to ${allowed}, not ${input.nextStatus}`
      );
    }
  }
  const decision = input.lineDecision;
  if (!decision) {
    return;
  }
  if (!isReleaseStatus(input.nextStatus)) {
    throw new Error(
      `A request line outcome is only meaningful on a release, not on a transition to ${input.nextStatus}`
    );
  }
  // Matches the guard rejectRequestItemAs has always had. A denial the
  // student cannot read a reason for is the thing that guard exists to stop.
  if (decision.outcome === "rejected" && !input.comment?.trim()) {
    throw new Error("Reject reason required");
  }
}

function validateInvariants(input: TransitionInput) {
  validateSelfServiceAndDecision(input);
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
      // A requested row always comes from an account (the requester), so it
      // has both an id and an address; it never carries a label, because a
      // request is always on a person, never on a thing. submitCartAs is the
      // one caller that reaches this arm, under the self_request authority,
      // once per surviving cart line. The lifecycle panel does not offer
      // "requested" as a direct target, so staff never land here.
      if (!(requestItemId && (holderId || holderEmail)) || holderLabel) {
        throw new Error(
          "requested status requires requestItemId and a holder account or address, no label"
        );
      }
      return;
    case "reserved":
    case "checked_out": {
      // A hold is on a person or on a thing, never both and never neither.
      // An id and an address both identify the same person, so they count as
      // one; name and program are attributes of that person, not a third
      // identity, and are excluded from the test entirely.
      //
      // This arm looks redundant now that `holdFromInput` builds a union in
      // which "both" is unrepresentable. It is not, and deleting it ships a
      // silent bug. Two reasons:
      //
      // 1. "Never neither" is status-dependent, and the Hold constructor never
      //    sees a status. `{ kind: "none" }` is a legal hold for an available
      //    item. Only this arm knows that it is not a legal one for a
      //    checkout, so without it a checkout with no holder saves silently.
      // 2. `inventory.integration.test.ts:140-157` asserts this exact wording.
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
 * UI concern). DOES enforce role and data invariants.
 */
export async function transitionItem(
  viewer: Viewer,
  input: TransitionInput,
  externalTx?: Tx
) {
  assertAuthorized(viewer, input);
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

  let closedAs: RequestLineOutcome | null = null;
  if (input.requestItemId) {
    await syncRequestItem(tx, input);
  } else if (current.currentRequestItemId) {
    // Item is leaving a hold context; close the line.
    closedAs = await closeRequestItemOnRelease(
      tx,
      current.currentRequestItemId,
      viewer.id,
      current.status,
      input.comment ?? null,
      input.lineDecision
    );
  }

  await maybeNotify(tx, current, input, holdAccountId(hold), closedAs);
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
): Promise<RequestLineOutcome> {
  // Fulfillment ended in the user's hands then came back: returned.
  // Otherwise (reserved abandoned, sent to maintenance/retired before pickup): cancelled.
  // A caller that knows better says so: only it can tell a staff refusal from
  // a staff release, since both end at available with a comment.
  const lineStatus =
    decision?.outcome ??
    (prevStatus === "checked_out" ? "returned" : "cancelled");
  const now = new Date();

  if (lineStatus === "rejected") {
    // The same precondition rejectRequestItemAs has always enforced. Without
    // it a release could stamp "rejected" over an approved or returned line
    // and overwrite the approver's own review columns, erasing the decision
    // that actually happened.
    const [line] = await tx
      .select({ status: inventoryRequestItems.status })
      .from(inventoryRequestItems)
      .where(eq(inventoryRequestItems.id, requestItemId))
      .for("update");
    if (!line) {
      throw new Error("Request line not found");
    }
    if (line.status !== "pending") {
      throw new Error("Only pending lines can be rejected");
    }
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
  return lineStatus;
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
  holderId: string | null,
  closedAs: RequestLineOutcome | null
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

  // A requester cancelling their own line is told nothing, because the only
  // person to tell is the one who just clicked the button. Keyed on the
  // authority rather than on a general "actor equals recipient" rule: staff
  // can assign a hold to their own address, and that case is also
  // actor-equals-recipient but does want its pickup deadline in the bell.
  if (input.authority === "self_cancel") {
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
      // Keyed on what was actually written to the line, not on what the
      // caller asked for. A refusal reads differently from a release, so it
      // gets its own type and wording even though both end at available.
      // notifications.type is text(), not a Postgres enum, so a new value
      // costs no migration.
      if (closedAs === "rejected") {
        await tx.insert(notifications).values({
          userId: recipientId,
          type: "inventory_request_rejected",
          title: `Request denied: ${prev.name}`,
          message: input.comment ?? `Your request for ${prev.name} was denied.`,
          link: "/my/items?tab=history",
        });
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
