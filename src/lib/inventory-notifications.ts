import type { ItemStatus } from "#/lib/vocabularies";
/**
 * Who receives an inventory notification, and what it says.
 *
 * Pure and client-safe, like `hold.ts`, `inventory-deadlines.ts`,
 * `inventory-visibility.ts` and `inventory-workflow.ts`, and for the same
 * reason: these were ninety-odd
 * lines of decision welded to five `tx.insert` calls, so the subtlest rule in
 * the domain could only be exercised through a full request lifecycle against
 * docker Postgres.
 *
 * The transaction's job is now the insert. This module's job is the choice.
 *
 * Input types are structural rather than the `TransitionInput` next door in
 * `inventory-workflow.ts`, which carries thirteen fields; six are read here,
 * and saying so is what keeps the two modules independent. That type is
 * Drizzle-free too, so this is a narrowing for its own sake, not the thing
 * that makes this file client-safe.
 */

import { overdueFlags } from "./inventory-deadlines";
import type { NotificationRow } from "./notification-row";

/** The item as it stood before the transition. */
export interface TransitionSubject {
  currentHolderId: string | null;
  currentRequestItemId: string | null;
  id: string;
  name: string;
  status: ItemStatus;
}

/** The parts of a transition this decision reads. */
export interface TransitionNotice {
  authority?: string | null;
  comment?: string | null;
  dueAt?: Date | null;
  nextStatus: ItemStatus;
  pickupBy?: Date | null;
  requestItemId?: string | null;
}

/** A request line closed by the transition, if one was. */
export interface ClosedLineOutcome {
  outcome: string;
  /** The account that submitted the request, when one was looked up. */
  requesterId: string | null;
}

function formatDate(d: Date | null | undefined): string {
  if (!d) {
    return "soon";
  }
  // `new Date(d)` rather than `d.toLocaleDateString` directly: a caller can
  // hand this a date that arrived as a string over the wire.
  return new Date(d).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/**
 * The one notification a status transition owes someone, or none.
 *
 * At most one row: no branch here has ever produced two. Multi-row lives in
 * `overdueNotifications` below.
 */
export function notificationFor(
  prev: TransitionSubject,
  input: TransitionNotice,
  holderId: string | null,
  closed: ClosedLineOutcome | null
): NotificationRow | null {
  // A denial is answered first, and to the requester, because it is the one
  // notice whose recipient is not "whoever holds the item". `closed` is only
  // set on the release path and a rejection is only legal there, so reaching
  // this means a line really was closed as rejected.
  //
  // It sits above the recipient guard below on purpose: that guard asks who
  // holds the item, and a hold on a bare label answers nobody, which would
  // silently swallow the denial owed to the person who asked.
  if (closed?.outcome === "rejected") {
    if (closed.requesterId) {
      return {
        userId: closed.requesterId,
        type: "inventory_request_rejected",
        title: `Request denied: ${prev.name}`,
        message: input.comment ?? `Your request for ${prev.name} was denied.`,
        link: "/my/items?tab=history",
      };
    }
    return null;
  }

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
    return null;
  }

  // A requester cancelling their own line is told nothing, because the only
  // person to tell is the one who just clicked the button. Keyed on the
  // authority rather than on a general "actor equals recipient" rule: staff
  // can assign a hold to their own address, and that case is also
  // actor-equals-recipient but does want its pickup deadline in the bell.
  if (input.authority === "self_cancel") {
    return null;
  }

  switch (input.nextStatus) {
    case "reserved": {
      const title = input.pickupBy
        ? `Reserved: ${prev.name}. Pick up by ${formatDate(input.pickupBy)}.`
        : `Reserved: ${prev.name}.`;
      return {
        userId: recipientId,
        type: "inventory_request_approved",
        title,
        message: `Your request for ${prev.name} was approved.`,
        link: "/my/items?tab=active",
      };
    }
    case "checked_out": {
      return {
        userId: recipientId,
        type: "inventory_item_checked_out",
        title: `Checked out: ${prev.name}. Due ${formatDate(input.dueAt)}.`,
        message: `${prev.name} is now in your hands.`,
        link: "/my/items?tab=active",
      };
    }
    case "available":
    case "maintenance":
    case "retired": {
      if (!isReleaseFromHold) {
        return null;
      }
      if (prev.status === "checked_out" && input.nextStatus === "available") {
        return {
          userId: recipientId,
          type: "inventory_item_returned",
          title: `Returned: ${prev.name}`,
          message: `Thanks for returning ${prev.name}.`,
          link: `/inventory/${prev.id}`,
        };
      }
      return {
        userId: recipientId,
        type: "inventory_request_closed",
        title: `Request closed: ${prev.name}`,
        message:
          input.comment ?? `Your request for ${prev.name} was closed by staff.`,
        link: "/my/items?tab=history",
      };
    }
    default:
      return null;
  }
}

/** A row the overdue scan is considering notifying about. */
export interface OverdueCandidate {
  dueAt: Date | null;
  itemId: string;
  itemName: string;
  pickupBy: Date | null;
  status: string;
  userId: string;
}

/**
 * The overdue notices these candidates are owed, deduped.
 *
 * `now` is a parameter for the same reason `overdueFlags` takes one: the
 * boundaries are the whole content of the rule.
 */
export function overdueNotifications(
  candidates: OverdueCandidate[],
  now: number = Date.now()
): NotificationRow[] {
  const rows: NotificationRow[] = [];
  const seen = new Set<string>();
  const push = (row: NotificationRow) => {
    // Requester and picker are the same person on most checkouts, so the two
    // scans return the same row twice. onConflictDoNothing would collapse
    // those intra-batch duplicates anyway; deduping here keeps the statement
    // smaller and makes the intent explicit rather than implicit in an index.
    const key = `${row.userId}|${row.type}|${row.link}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    rows.push(row);
  };

  for (const r of candidates) {
    const { pickupOverdue, checkoutOverdue } = overdueFlags(r, now);
    if (pickupOverdue) {
      push({
        userId: r.userId,
        type: "inventory_pickup_overdue",
        title: `Pickup window passed: ${r.itemName}`,
        message: "Your reserved item is past its pickup window.",
        link: `/inventory/${r.itemId}`,
      });
    }
    if (checkoutOverdue) {
      push({
        userId: r.userId,
        type: "inventory_checkout_overdue",
        title: `Overdue: ${r.itemName}`,
        message: "Your checked-out item is past its due date.",
        link: `/inventory/${r.itemId}`,
      });
    }
  }

  return rows;
}
