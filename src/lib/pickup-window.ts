/**
 * The pickup window: a day, and optionally a From and To time on it, as staff
 * type them on approval, turned into the two instants the item and the
 * request line store, and back into the words a requester reads.
 *
 * Pure and client-safe, like `inventory-deadlines.ts`, because the dialogs,
 * the notice and `/my/items` all have to agree on what a window means.
 *
 * Every day and time is the office's (`OFFICE_TIME_ZONE`), never the
 * browser's or the server's. A day sent as `new Date("2026-10-28")` is UTC
 * midnight, which in Corvallis is the evening before (#805); composing the
 * instant here, from the strings, is what keeps the 28th the 28th.
 */
import {
  dayEnd,
  formatOfficeDay,
  lastDeadlineDay,
  localDay,
  localInstant,
  OFFICE_TIME_ZONE,
  shiftDay,
} from "./day-range";

/** What staff type: a `YYYY-MM-DD` day and two `HH:MM` times, all optional. */
export interface PickupWindowInput {
  pickupDay: string | null;
  pickupFromTime: string | null;
  pickupToTime: string | null;
}

export interface PickupWindow {
  /**
   * The end of the window, which is the pickup deadline the overdue rule
   * reads. Null when staff gave no day; the caller decides the default.
   */
  pickupBy: Date | null;
  /** The start of the window. Null for a day given without times. */
  pickupFrom: Date | null;
}

/**
 * The window these fields describe, or a refusal staff read under the form.
 *
 * A day alone means the whole of that day, so its deadline is the day's last
 * millisecond: midnight would render as the next day. A window may start
 * before `now`, since staff approving at 3 pm for "2 to 4 today" mean it; it
 * may not have ended. `now` is a parameter for the reason `overdueFlags`
 * gives: the boundary is the rule.
 */
export function resolvePickupWindow(
  fields: PickupWindowInput,
  now: number = Date.now()
): PickupWindow {
  const day = fields.pickupDay?.trim() || null;
  const from = fields.pickupFromTime?.trim() || null;
  const to = fields.pickupToTime?.trim() || null;
  if (!day) {
    if (from || to) {
      throw new Error("Pick a pickup day to go with the times.");
    }
    return { pickupFrom: null, pickupBy: null };
  }
  // The wire shape lets "2026-02-31" through, and the arithmetic below would
  // quietly read it as March 3. A day that does not survive a round trip
  // through the calendar is not one.
  if (shiftDay(day, 0) !== day) {
    throw new Error("Pick a pickup day that is on the calendar.");
  }
  if (day > lastDeadlineDay(now)) {
    throw new Error("Pick a pickup day within the next year.");
  }
  if (Boolean(from) !== Boolean(to)) {
    throw new Error("Give both a From and a To, or neither.");
  }
  const pickupFrom = from ? localInstant(day, from) : null;
  const pickupBy = to ? localInstant(day, to) : dayEnd(day);
  if (pickupFrom && pickupFrom.getTime() >= pickupBy.getTime()) {
    throw new Error("The pickup window has to end after it starts.");
  }
  if (pickupBy.getTime() < now) {
    throw new Error("That pickup window has already ended.");
  }
  return { pickupFrom, pickupBy };
}

/** Everything staff type about a pickup: the window, where, and a note. */
export interface PickupInput extends PickupWindowInput {
  pickupNote: string | null;
  pickupPlace: string | null;
}

/** The pickup terms as `TransitionInput` carries them. */
export interface PickupTerms extends PickupWindow {
  pickupNote: string | null;
  pickupPlace: string | null;
}

/**
 * The window resolved, and the place and note trimmed, with blank as null so
 * a field staff cleared stores nothing rather than whitespace.
 */
export function resolvePickupTerms(
  fields: PickupInput,
  now: number = Date.now()
): PickupTerms {
  return {
    ...resolvePickupWindow(fields, now),
    pickupPlace: fields.pickupPlace?.trim() || null,
    pickupNote: fields.pickupNote?.trim() || null,
  };
}

/** A day picked today, as the office reads it, for a date input's `min`. */
export function officeToday(now: number = Date.now()): string {
  return localDay(new Date(now));
}

/**
 * The fields that would reproduce a stored window, for a dialog reopened on
 * an item that already has one. A deadline with no start (a day alone, or the
 * seven-day default) comes back as its day alone.
 */
export function pickupWindowInput(
  pickupFrom: Date | string | null | undefined,
  pickupBy: Date | string | null | undefined
): PickupWindowInput {
  if (!pickupBy) {
    return { pickupDay: null, pickupFromTime: null, pickupToTime: null };
  }
  const by = new Date(pickupBy);
  const day = localDay(by);
  if (!pickupFrom) {
    return { pickupDay: day, pickupFromTime: null, pickupToTime: null };
  }
  return {
    pickupDay: day,
    pickupFromTime: clockOf(new Date(pickupFrom)),
    pickupToTime: clockOf(by),
  };
}

/**
 * The window in words, in the office's zone: "Oct 28, 2026" for a day, or
 * "Oct 28, 2026, 2:00 PM to 4:00 PM" for a window. Null with no deadline.
 *
 * Built from parts with plain spaces rather than `toLocaleString`, so the
 * server and the browser render the same bytes: ICU versions disagree about
 * the narrow no-break space before "PM", and a mismatch there is a hydration
 * error on `/my/items`. A fixed zone is what makes `LocalTime` unnecessary.
 */
export function formatPickupWindow(
  pickupFrom: Date | string | null | undefined,
  pickupBy: Date | string | null | undefined
): string | null {
  if (!pickupBy) {
    return null;
  }
  const by = new Date(pickupBy);
  const date = formatOfficeDay(by);
  if (!pickupFrom) {
    return date;
  }
  return `${date}, ${timeOf(new Date(pickupFrom))} to ${timeOf(by)}`;
}

/**
 * What to do and when, as one phrase: "Pick up on" a window, "Pick up by" a
 * deadline. One place, so the email and `/my/items` say it the same way.
 */
export function pickupPhrase(
  pickupFrom: Date | string | null | undefined,
  pickupBy: Date | string | null | undefined
): string | null {
  const when = formatPickupWindow(pickupFrom, pickupBy);
  if (!when) {
    return null;
  }
  return pickupFrom ? `Pick up on ${when}` : `Pick up by ${when}`;
}

/**
 * The one sentence that tells a requester what to do when the window does not
 * suit them. Null without an inbox, so a deployment with none says nothing
 * rather than "email null".
 */
export function pickupContactSentence(
  staffInbox: string | null
): string | null {
  return staffInbox ? `If this time doesn't work, email ${staffInbox}.` : null;
}

const TIME_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  hour12: true,
  minute: "2-digit",
  timeZone: OFFICE_TIME_ZONE,
});

const CLOCK_FORMAT = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  hourCycle: "h23",
  minute: "2-digit",
  timeZone: OFFICE_TIME_ZONE,
});

function partsOf(format: Intl.DateTimeFormat, d: Date) {
  return Object.fromEntries(
    format.formatToParts(d).map((p) => [p.type, p.value])
  );
}

/** "2:00 PM", with a plain space whatever the ICU version. */
function timeOf(d: Date): string {
  const p = partsOf(TIME_FORMAT, d);
  return `${p.hour}:${p.minute} ${p.dayPeriod}`;
}

/** "14:00", the value an `<input type="time">` takes. */
function clockOf(d: Date): string {
  const p = partsOf(CLOCK_FORMAT, d);
  return `${p.hour}:${p.minute}`;
}
