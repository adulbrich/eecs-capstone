/**
 * Deadlines on inventory items: what a due date picked as a day stands for,
 * whether one is overdue, and how a list of them is ordered.
 *
 * Pure and client-safe, like `hold.ts`, `inventory-notifications.ts`,
 * `inventory-visibility.ts` and `inventory-workflow.ts`, and for the same
 * reason: the notification path and the page a student lands on have
 * to agree about what "overdue" means, and they cannot if the rule lives
 * inside a server-only file that only one of them can import.
 *
 * `docs/adr/0005-lazy-deadlines-no-scheduler.md` records the decision this
 * depends on: there is no cron.
 * Deadlines are informational columns and overdue is derived at query time,
 * which is why this is a rule rather than a stored flag.
 */
import { dayEnd, lastDeadlineDay, shiftDay } from "./day-range";

/**
 * The deadline a due date picked as a day stands for: the last millisecond
 * of that day in the office's zone. Reading "2026-10-25" as UTC midnight made
 * the item overdue at 5 pm on the 24th and showed the 24th on the page while
 * the email said the 25th (#805). Blank means no due date; the workflow
 * decides whether the transition may go without one. A past day is allowed,
 * as it always was; `now` only bounds how far out the day may be.
 */
export function dueAtForDay(
  day: string | null | undefined,
  now: number = Date.now()
): Date | null {
  const picked = day?.trim() || null;
  if (!picked) {
    return null;
  }
  // The wire shape lets "2026-02-31" through, and the arithmetic would read
  // it as March 3; `resolvePickupWindow` refuses it the same way.
  if (shiftDay(picked, 0) !== picked) {
    throw new Error("Pick a due date that is on the calendar.");
  }
  if (picked > lastDeadlineDay(now)) {
    throw new Error("Pick a due date within the next year.");
  }
  return dayEnd(picked);
}

/**
 * The three fields the overdue rule reads.
 *
 * `status` is the **item's**, never the request line's. An approved line sits
 * on an item that is either `reserved` (pre-pickup) or `checked_out`
 * (post-pickup), and that distinction is what decides which of the two dates
 * the item is answerable for.
 */
export interface DeadlinePair {
  dueAt: Date | null;
  pickupBy: Date | null;
  status: string;
}

export interface OverdueFlags {
  checkoutOverdue: boolean;
  pickupOverdue: boolean;
}

/**
 * Whether this item has missed a deadline.
 *
 * `now` is a parameter rather than a call to `Date.now()` inside, because the
 * boundaries are the entire content of this rule and a rule you cannot test at
 * its boundaries is a rule you are guessing about.
 *
 * Strictly past, not at: a deadline of noon has not been missed at noon.
 */
export function overdueFlags(
  pair: DeadlinePair,
  now: number = Date.now()
): OverdueFlags {
  return {
    pickupOverdue:
      pair.status === "reserved" &&
      !!pair.pickupBy &&
      pair.pickupBy.getTime() < now,
    checkoutOverdue:
      pair.status === "checked_out" &&
      !!pair.dueAt &&
      pair.dueAt.getTime() < now,
  };
}

/**
 * Whether either deadline has been missed, for a caller that does not care
 * which. The staff listing filter asks this; the badge asks `overdueFlags`,
 * because it renders a different word for each kind.
 */
export function isOverdue(
  pair: DeadlinePair,
  now: number = Date.now()
): boolean {
  const flags = overdueFlags(pair, now);
  return flags.pickupOverdue || flags.checkoutOverdue;
}

/**
 * An entry on the Active tab, structurally.
 *
 * A hold has no request line by definition, so this is a union rather than a
 * line with optional fields, and the two arms store the same pair in different
 * places. Typed structurally rather than importing the server's `ActiveEntry`:
 * this module needs four fields and says so, which keeps it usable by anything
 * that has them.
 */
export type DeadlineEntry =
  | {
      item: {
        dueAt: Date | null;
        pickupBy: Date | null;
        status: string;
        updatedAt: Date;
      };
      kind: "hold";
    }
  | {
      itemStatus: string;
      kind: "request";
      line: { createdAt: Date; dueAt: Date | null; pickupBy: Date | null };
    };

/**
 * The one place that knows which arm keeps the deadline pair where.
 *
 * Both the server's sort and the client's badge read this. Without it each
 * would have to know that a hold's dates are on the item and a request's are
 * on the line, and the two copies would be free to disagree.
 */
export function deadlinePairOf(entry: DeadlineEntry): DeadlinePair {
  if (entry.kind === "hold") {
    return {
      status: entry.item.status,
      pickupBy: entry.item.pickupBy,
      dueAt: entry.item.dueAt,
    };
  }
  return {
    status: entry.itemStatus,
    pickupBy: entry.line.pickupBy,
    dueAt: entry.line.dueAt,
  };
}

/** The date this entry is ordered by: the due date, else the pickup date. */
export function deadlineOf(entry: DeadlineEntry): Date | null {
  const pair = deadlinePairOf(entry);
  return pair.dueAt ?? pair.pickupBy;
}

/**
 * A hold has no request line, so its "created" moment is when the item row was
 * last written. A pending request line has not been touched since it was
 * created, so its createdAt and updatedAt agree anyway.
 */
function recencyOf(entry: DeadlineEntry): Date {
  return entry.kind === "hold" ? entry.item.updatedAt : entry.line.createdAt;
}

/**
 * Soonest deadline first, entries without one last, newest first within a tie,
 * including the common case of two entries that both have no deadline.
 *
 * That last fallback is the `created_at DESC` order the Active tab had before
 * holds existed, kept for everything a deadline cannot order.
 */
export function compareByDeadline(a: DeadlineEntry, b: DeadlineEntry): number {
  const left = deadlineOf(a);
  const right = deadlineOf(b);
  if (left && right) {
    return (
      left.getTime() - right.getTime() ||
      recencyOf(b).getTime() - recencyOf(a).getTime()
    );
  }
  if (left) {
    return -1;
  }
  if (right) {
    return 1;
  }
  return recencyOf(b).getTime() - recencyOf(a).getTime();
}

/** Within this many days counts as due soon on the borrower's own page. */
export const SOON_DAYS = 3;

export interface AttentionSummary {
  overduePickups: number;
  overdueReturns: number;
  pickupsDueSoon: number;
  returnsDueSoon: number;
}

/**
 * What on the Active tab is being asked of the borrower right now, so the
 * page can open by answering "is anything wrong" instead of leaving seven
 * near-identical rows to be read (#64). Overdue comes from `overdueFlags`,
 * the same predicate the badge and the bell use; "soon" is the same deadline
 * pair looked at from the other side of now.
 */
export function attentionSummary(
  entries: readonly DeadlineEntry[],
  now: Date
): AttentionSummary {
  const summary: AttentionSummary = {
    overdueReturns: 0,
    overduePickups: 0,
    returnsDueSoon: 0,
    pickupsDueSoon: 0,
  };
  const horizon = now.getTime() + SOON_DAYS * 86_400_000;
  const soon = (date: Date | null) =>
    date !== null &&
    date.getTime() >= now.getTime() &&
    date.getTime() <= horizon;
  for (const entry of entries) {
    const pair = deadlinePairOf(entry);
    const flags = overdueFlags(pair, now.getTime());
    if (flags.checkoutOverdue) {
      summary.overdueReturns += 1;
    } else if (pair.status === "checked_out" && soon(pair.dueAt)) {
      summary.returnsDueSoon += 1;
    }
    if (flags.pickupOverdue) {
      summary.overduePickups += 1;
    } else if (pair.status === "reserved" && soon(pair.pickupBy)) {
      summary.pickupsDueSoon += 1;
    }
  }
  return summary;
}

export function needsAttention(summary: AttentionSummary): boolean {
  return (
    summary.overdueReturns +
      summary.overduePickups +
      summary.returnsDueSoon +
      summary.pickupsDueSoon >
    0
  );
}
