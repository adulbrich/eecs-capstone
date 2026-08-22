import type React from "react";
import {
  type DeadlineEntry,
  deadlinePairOf,
  overdueFlags,
} from "#/lib/inventory-deadlines";
import { Badge } from "./ui/badge";

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
    return <BadgeBox style={ERROR}>Overdue</BadgeBox>;
  }
  if (pickupOverdue) {
    return <BadgeBox style={WARNING}>Pickup overdue</BadgeBox>;
  }
  return null;
}

function BadgeBox({
  children,
  style,
}: {
  children: React.ReactNode;
  style: React.CSSProperties;
}) {
  return (
    <Badge style={style} variant="status">
      {children}
    </Badge>
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
