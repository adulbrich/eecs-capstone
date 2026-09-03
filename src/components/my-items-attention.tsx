import { Link } from "@tanstack/react-router";
import {
  attentionSummary,
  type DeadlineEntry,
  needsAttention,
  SOON_DAYS,
} from "#/lib/inventory-deadlines";

/**
 * The line `/my/items` opens with: is anything being asked of you right now
 * (#64). Driven by the same deadline data the `OverdueBadge` reads, so the
 * summary and the badges cannot disagree. Nothing at all for an account with
 * nothing active; a quiet line when everything is in order; a warning region
 * with counts and a link into the Active tab otherwise.
 */
export function NeedsAttention({
  entries,
  now = new Date(),
}: {
  entries: readonly DeadlineEntry[];
  now?: Date;
}) {
  if (entries.length === 0) {
    return null;
  }
  const summary = attentionSummary(entries, now);
  if (!needsAttention(summary)) {
    return (
      <p className="mt-4 text-muted-foreground text-sm">
        Nothing needs your attention right now.
      </p>
    );
  }
  const urgent = summary.overdueReturns + summary.overduePickups > 0;
  const tone = urgent ? "error" : "warning";
  const lines = [
    plural(
      summary.overdueReturns,
      "item overdue for return",
      "items overdue for return"
    ),
    plural(summary.overduePickups, "pickup overdue", "pickups overdue"),
    plural(
      summary.returnsDueSoon,
      `return due within ${SOON_DAYS} days`,
      `returns due within ${SOON_DAYS} days`
    ),
    plural(
      summary.pickupsDueSoon,
      `pickup due within ${SOON_DAYS} days`,
      `pickups due within ${SOON_DAYS} days`
    ),
  ].filter((line): line is string => line !== null);
  return (
    <section
      aria-labelledby="needs-attention-heading"
      className="mt-4 rounded-lg border p-4"
      style={{
        borderColor: `var(--status-${tone})`,
        backgroundColor: `var(--status-${tone}-bg)`,
      }}
    >
      <h2
        className="font-medium text-sm"
        id="needs-attention-heading"
        style={{ color: `var(--status-${tone})` }}
      >
        Needs your attention
      </h2>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {lines.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <p className="mt-2 text-sm">
        <Link
          className="text-brand hover:underline"
          search={{ tab: "active" }}
          to="/my/items"
        >
          See them under Active
        </Link>
      </p>
    </section>
  );
}

function plural(count: number, one: string, many: string): string | null {
  if (count === 0) {
    return null;
  }
  return `${count} ${count === 1 ? one : many}`;
}
