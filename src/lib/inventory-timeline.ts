/**
 * The timeline of one line, built from its own columns.
 *
 * Pure and client-safe, like `hold.ts`, `inventory-deadlines.ts`,
 * `inventory-notifications.ts`, `inventory-visibility.ts` and
 * `inventory-workflow.ts`, and for the same reason: the staff queue and the
 * requester's own page draw the same three events, and they cannot agree
 * about what those events are if the rule lives inside one route.
 *
 * Three events at most, from columns rather than from a log: submitted (the
 * envelope's `created_at`), decided (`reviewed_at`) and closed (`closed_at`).
 * A line visits at most three of its five statuses, pending, then at most one
 * intermediate, then one terminal, so those columns are the complete record.
 * `inventory_item_status_history` cannot serve here: its `new_status` is the
 * item's, so a release to `available` is written identically whether the line
 * was returned, cancelled or rejected.
 *
 * The caller says what the decision and the close are called, because the two
 * kinds of line name them differently: a request line is approved and then
 * returned or cancelled, a custom line is sourcing and then fulfilled. The
 * caller also decides whether anyone is named. The requester's page passes no
 * actors, and this module adds nothing back.
 */

export interface TimelineEvent {
  /** A display name for staff; null when the audience is not told who. */
  actor: string | null;
  at: Date;
  kind: "closed" | "decided" | "submitted";
  label: string;
  note: string | null;
}

export interface TimelineInput {
  closedAt: Date | null;
  closedBy?: string | null;
  /** What the close is called: Rejected, Cancelled, Returned, Fulfilled. */
  closedLabel: string;
  closedNote: string | null;
  /** What the decision is called: Approved on a request line, Sourcing on a custom line. */
  decidedLabel: string;
  /** The note the decision carried, when that kind of line has one. */
  decidedNote?: string | null;
  reviewedAt: Date | null;
  reviewedBy?: string | null;
  submittedAt: Date;
}

/**
 * The events a line has had, oldest first.
 *
 * A rejection writes `reviewed_at` and `closed_at` at the same instant, and
 * so does a custom line refused straight from pending. One event, not two:
 * the decided event is emitted only when the decision came strictly before
 * the close, which is the approved-then-returned shape and the
 * sourcing-then-fulfilled one.
 */
export function lineTimeline(input: TimelineInput): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      actor: null,
      at: input.submittedAt,
      kind: "submitted",
      label: "Submitted",
      note: null,
    },
  ];
  const decidedBeforeClose =
    input.reviewedAt !== null &&
    (input.closedAt === null ||
      input.reviewedAt.getTime() < input.closedAt.getTime());
  if (input.reviewedAt !== null && decidedBeforeClose) {
    events.push({
      actor: input.reviewedBy ?? null,
      at: input.reviewedAt,
      kind: "decided",
      label: input.decidedLabel,
      note: input.decidedNote ?? null,
    });
  }
  if (input.closedAt !== null) {
    events.push({
      actor: input.closedBy ?? null,
      at: input.closedAt,
      kind: "closed",
      label: input.closedLabel,
      note: input.closedNote,
    });
  }
  return events;
}
