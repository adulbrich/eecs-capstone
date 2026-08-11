import type React from "react";
import {
  type DeadlineEntry,
  deadlinePairOf,
  overdueFlags,
} from "#/lib/inventory-deadlines";

/**
 * Says an item has missed a deadline, beside the status badge where a reader
 * already looks for the item's state.
 *
 * Two labels rather than one, because they ask the student for different
 * things: "Pickup overdue" means collect this, "Overdue" means bring it back.
 * A late return is the more serious of the two, so it takes the error tokens
 * while a missed pickup takes the warning ones.
 *
 * The flags come from the same `overdueFlags` the notification path uses, so
 * the badge and the bell cannot disagree about what overdue means.
 */
export function OverdueBadge({ entry }: { entry: DeadlineEntry }) {
  const { pickupOverdue, checkoutOverdue } = overdueFlags(
    deadlinePairOf(entry)
  );

  if (checkoutOverdue) {
    return <Badge style={ERROR}>Overdue</Badge>;
  }
  if (pickupOverdue) {
    return <Badge style={WARNING}>Pickup overdue</Badge>;
  }
  return null;
}

function Badge({
  children,
  style,
}: {
  children: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <span
      className="inline-flex items-center rounded px-2 py-0.5 font-medium text-xs"
      style={style}
    >
      {children}
    </span>
  );
}

const WARNING: React.CSSProperties = {
  background: "var(--status-warning-bg)",
  color: "var(--status-warning)",
};

const ERROR: React.CSSProperties = {
  background: "var(--status-error-bg)",
  color: "var(--status-error)",
};
