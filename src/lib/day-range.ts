/**
 * Calendar days as the office reads them, turned into instants.
 *
 * Every timestamp in this app is stored with its zone and compared as an
 * instant, but a date typed into a From or To input is a calendar day in the
 * zone of the person typing it, and that person sits in Corvallis. Reading
 * "2026-06-30" as `T00:00:00Z` puts a project published at 10pm Pacific on
 * the 30th into July, which is what `/admin/analytics` did before #335. Both
 * pages now go through here, so a date means the same thing on both.
 *
 * No library: `Intl.DateTimeFormat` knows the zone's offset at any instant,
 * and local midnight is found by guessing the UTC midnight, asking for the
 * offset there, and checking the answer once more in case the guess landed
 * across a DST change. Pure and dependency-free, like the rest of `src/lib`.
 */
export const OFFICE_TIME_ZONE = "America/Los_Angeles";

const DAY_MS = 86_400_000;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

const partsFormatter = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatter.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      hour: "2-digit",
      hourCycle: "h23",
      minute: "2-digit",
      month: "2-digit",
      second: "2-digit",
      timeZone,
      year: "numeric",
    });
    partsFormatter.set(timeZone, f);
  }
  return f;
}

/** The zone's offset from UTC at `instant`, in milliseconds (positive east). */
function offsetAt(instant: number, timeZone: string): number {
  const parts = Object.fromEntries(
    formatter(timeZone)
      .formatToParts(new Date(instant))
      .map((p) => [p.type, p.value])
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function parseDay(day: string): [number, number, number] {
  const m = DAY.exec(day);
  if (!m) {
    throw new Error(`not a YYYY-MM-DD day: ${day}`);
  }
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Midnight at the start of `day` in `timeZone`, as an instant. */
export function dayStart(day: string, timeZone = OFFICE_TIME_ZONE): Date {
  const [y, m, d] = parseDay(day);
  const guess = Date.UTC(y, m - 1, d);
  const first = guess - offsetAt(guess, timeZone);
  // A guess made the wrong side of a DST change is off by the change; one
  // more look at the offset where the first answer landed corrects it.
  const second = guess - offsetAt(first, timeZone);
  return new Date(second);
}

/** `day` moved by `delta` calendar days, DST-free arithmetic on the date. */
export function shiftDay(day: string, delta: number): string {
  const [y, m, d] = parseDay(day);
  return new Date(Date.UTC(y, m - 1, d) + delta * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

/** The number of calendar days from `from` to `to`, both counted. */
export function daysInclusive(from: string, to: string): number {
  const [fy, fm, fd] = parseDay(from);
  const [ty, tm, td] = parseDay(to);
  return (
    Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / DAY_MS) +
    1
  );
}

/**
 * The half-open span `[start, end)` that holds every instant of the days
 * from `from` through `to` in the office's zone: `end` is midnight at the
 * start of the day after `to`, so a `< end` comparison keeps the whole of
 * `to`. Either bound may be absent, which leaves that side open.
 */
export function dayRange(
  from: string | null | undefined,
  to: string | null | undefined,
  timeZone = OFFICE_TIME_ZONE
): { start: Date | null; end: Date | null } {
  return {
    start: from ? dayStart(from, timeZone) : null,
    end: to ? dayStart(shiftDay(to, 1), timeZone) : null,
  };
}
