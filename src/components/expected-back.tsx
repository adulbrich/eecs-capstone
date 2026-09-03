import { LocalTime } from "./local-time";

/**
 * When an unavailable item might be back, for whoever is reading the item
 * page: the one question a prospective borrower has about an item they cannot
 * request, and the only hold date the public payload carries (#193).
 *
 * A past date renders the same way. Overdue is a staff concern, and saying it
 * publicly points at the holder. An available item renders nothing whatever
 * the column holds, because a stale date on a returned item is not a promise.
 */
export function ExpectedBack({
  dueAt,
  status,
}: {
  dueAt: Date | string | null;
  status: string;
}) {
  if (status === "available" || !dueAt) {
    return null;
  }
  return (
    <p className="mt-2 text-muted-foreground text-sm">
      Expected back on <LocalTime dateOnly value={dueAt} />.
    </p>
  );
}
