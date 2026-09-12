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
import type { ItemStatus, NotificationType } from "./vocabularies";

/**
 * Who a notice is for: an account, an address, or both. A walk-in hold has an
 * address and no account, which is why this is not a bare user id: the bell
 * needs the id, the inbox needs the address, and a notice decides its
 * recipient once for both channels.
 */
export interface NoticeRecipient {
  accountId: string | null;
  email: string | null;
}

/** One notice, before it is split into a bell row and an email. */
export interface InventoryNotice {
  link: string;
  message: string;
  recipient: NoticeRecipient;
  title: string;
  type: NotificationType;
}

/** Someone is there to tell: an account, an address, or both. */
function reachable(
  recipient: NoticeRecipient | null
): recipient is NoticeRecipient {
  return Boolean(recipient?.accountId || recipient?.email);
}

/** The bell row a notice becomes, or none when the recipient has no account. */
export function toNotificationRow(
  notice: InventoryNotice | null
): NotificationRow | null {
  const accountId = notice?.recipient.accountId;
  if (!(notice && accountId)) {
    return null;
  }
  const { recipient: _recipient, ...rest } = notice;
  return { ...rest, userId: accountId };
}

/**
 * The inventory notices that also go by email: the ones whose recipient must
 * act away from the app (a pickup window, a due date, a refusal). The rest are
 * confirmations and stay in the bell. PRD section 13 is the table.
 */
export const EMAILED_INVENTORY_TYPES: ReadonlySet<NotificationType> =
  new Set<NotificationType>([
    "inventory_request_approved",
    "inventory_request_rejected",
    "inventory_item_checked_out",
    "inventory_custom_fulfilled",
    "inventory_custom_rejected",
  ]);

/** The item as it stood before the transition. */
export interface TransitionSubject {
  currentHolderEmail: string | null;
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
  /** See `TransitionInput.silent`: the fulfill path speaks for itself. */
  silent?: boolean | null;
}

/** A request line closed by the transition, if one was. */
export interface ClosedLineOutcome {
  outcome: string;
  /** The requester's address, looked up beside the id. */
  requesterEmail: string | null;
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
 * At most one notice: no branch here has ever produced two. Multi-row lives in
 * `overdueNotifications` below. `holder` is the hold the transition assigns,
 * as an account, an address, or neither; a release reads the previous holder
 * off the item instead.
 */
export function notificationFor(
  prev: TransitionSubject,
  input: TransitionNotice,
  holder: NoticeRecipient | null,
  closed: ClosedLineOutcome | null
): InventoryNotice | null {
  // Before everything, including the denial: the one caller that sets this
  // is fulfilling a custom line, which never closes a request line and
  // writes its own single notice afterwards.
  if (input.silent) {
    return null;
  }
  // A denial is answered first, and to the requester, because it is the one
  // notice whose recipient is not "whoever holds the item". `closed` is only
  // set on the release path and a rejection is only legal there, so reaching
  // this means a line really was closed as rejected.
  //
  // It sits above the recipient guard below on purpose: that guard asks who
  // holds the item, and a hold on a bare label answers nobody, which would
  // silently swallow the denial owed to the person who asked.
  if (closed?.outcome === "rejected") {
    const requester = {
      accountId: closed.requesterId,
      email: closed.requesterEmail,
    };
    if (!reachable(requester)) {
      return null;
    }
    return {
      recipient: requester,
      type: "inventory_request_rejected",
      title: `Request denied: ${prev.name}`,
      message: input.comment ?? `Your request for ${prev.name} was denied.`,
      link: "/my/items?filter=closed",
    };
  }

  // Identify a "release-from-hold" path: no new request context provided AND
  // the item was held by someone. The original holder is then the recipient.
  // A walk-in hold has no request line, so testing only for one would silently
  // drop the return notification for every staff-assigned checkout.
  const isReleaseFromHold =
    !input.requestItemId &&
    (!!prev.currentRequestItemId || !!prev.currentHolderId);

  const recipient = holder ?? (isReleaseFromHold ? previousHolder(prev) : null);
  if (!reachable(recipient)) {
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
        recipient,
        type: "inventory_request_approved",
        title,
        message: `Your request for ${prev.name} was approved.`,
        link: "/my/items?filter=open",
      };
    }
    case "checked_out": {
      return {
        recipient,
        type: "inventory_item_checked_out",
        title: `Checked out: ${prev.name}. Due ${formatDate(input.dueAt)}.`,
        message: `${prev.name} is now in your hands.`,
        link: "/my/items?filter=open",
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
          recipient,
          type: "inventory_item_returned",
          title: `Returned: ${prev.name}`,
          message: `Thanks for returning ${prev.name}.`,
          link: `/inventory/${prev.id}`,
        };
      }
      return {
        recipient,
        type: "inventory_request_closed",
        title: `Request closed: ${prev.name}`,
        message:
          input.comment ?? `Your request for ${prev.name} was closed by staff.`,
        link: "/my/items?filter=closed",
      };
    }
    default:
      return null;
  }
}

/** The person the item was held for, as the item row remembers them. */
function previousHolder(prev: TransitionSubject): NoticeRecipient {
  return { accountId: prev.currentHolderId, email: prev.currentHolderEmail };
}

/** The four things a custom line can tell its requester. */
export type CustomLineEvent =
  | "fulfilled"
  | "rejected"
  | "sourcing"
  | "sourcing_note";

export interface CustomLineNotice {
  /** The items a fulfillment linked, in the order they were linked. */
  items?: { name: string }[];
  name: string;
  /** The note the event carries: the sourcing note, or the outcome note. */
  note: string | null;
  /** Set when a fulfillment reserved the items; null when it did not. */
  pickupBy?: Date | null;
  requesterEmail: string | null;
  requesterId: string;
}

/**
 * The one notification a custom line event owes its requester. Each carries
 * the note it belongs to verbatim when it is non-empty. One notice per
 * fulfill, whatever the item count. Fulfilled and rejected also go by email
 * (`EMAILED_INVENTORY_TYPES`); the staff side is told of a submission by
 * email too, from `inventory-emails.ts`, beside the admin overview tile.
 */
export function customLineNotification(
  event: CustomLineEvent,
  notice: CustomLineNotice
): InventoryNotice {
  const note = notice.note?.trim() ? notice.note : null;
  const recipient: NoticeRecipient = {
    accountId: notice.requesterId,
    email: notice.requesterEmail,
  };
  switch (event) {
    case "sourcing":
      return {
        recipient,
        type: "inventory_custom_sourcing",
        title: `Sourcing: ${notice.name}`,
        message: note ?? `Staff are getting ${notice.name}.`,
        link: "/my/items?filter=open",
      };
    case "sourcing_note":
      return {
        recipient,
        type: "inventory_custom_sourcing_note",
        title: `Update on ${notice.name}`,
        message: note ?? `The plan for ${notice.name} changed.`,
        link: "/my/items?filter=open",
      };
    case "fulfilled": {
      const names = (notice.items ?? []).map((item) => item.name).join(", ");
      const reserved = notice.pickupBy
        ? `${names} reserved for you. Pick up by ${formatDate(notice.pickupBy)}.`
        : `${names} now in the inventory.`;
      return {
        recipient,
        type: "inventory_custom_fulfilled",
        title: `Fulfilled: ${notice.name}`,
        message: note ? `${reserved} ${note}` : reserved,
        // The line is closed, but a reservation is open and is what the
        // requester acts on next; without one, the closed view holds it.
        link: notice.pickupBy
          ? "/my/items?filter=open"
          : "/my/items?filter=closed",
      };
    }
    case "rejected":
      return {
        recipient,
        type: "inventory_custom_rejected",
        title: `Request denied: ${notice.name}`,
        message: note ?? `Your request for ${notice.name} was denied.`,
        link: "/my/items?filter=closed",
      };
    default: {
      const unhandled: never = event;
      throw new Error(`No notification for ${String(unhandled)}`);
    }
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
