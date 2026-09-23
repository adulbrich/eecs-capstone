/**
 * The date range an admin report reads from its URL, shared by
 * `/admin/analytics` (#34) and `/admin/traffic` (#592) so a link to either
 * means the same days. Pure and client-safe.
 */

const DAY_MS = 86_400_000;

/**
 * Today moved by `offset` days, as `YYYY-MM-DD`. The UTC day, not the
 * office's: a known gap carried over unchanged from `/admin/analytics`, so a
 * visit after 5pm Pacific defaults to tomorrow as the range's end.
 */
export function isoDay(offset: number, now: Date = new Date()): string {
  return new Date(now.getTime() + offset * DAY_MS).toISOString().slice(0, 10);
}

/**
 * The range a report shows: the URL's `from` and `to`, each defaulting to
 * the last thirty days, and put in order if the reader typed them backwards.
 */
export function resolveRange(
  search: { from?: string; to?: string },
  now: Date = new Date()
): { from: string; to: string } {
  const to = search.to ?? isoDay(0, now);
  const from = search.from ?? isoDay(-30, now);
  return from <= to ? { from, to } : { from: to, to: from };
}
