import { z } from "zod";
import { TIME_PATTERN } from "#/lib/day-range";
import { DAY_PATTERN } from "#/lib/report-range";

/**
 * A calendar day as a date input sends it, `YYYY-MM-DD`, for the server to
 * read in the office's zone. Blank ("") and null both mean unset. The due
 * date takes the same shape for the same reason (#805).
 */
export const OFFICE_DAY_FIELD = z
  .string()
  .regex(DAY_PATTERN)
  .or(z.literal(""))
  .nullable()
  .default(null);

/**
 * Refuses a payload from a tab loaded before #805, which still sends a picked
 * day as `dueAt` or `pickupBy`. The schema would drop the key without a word:
 * a checkout would fail on wording meant for developers, and a Fulfil would
 * reserve with the seven-day default instead of the day staff picked. Those
 * tabs send the key as null when no day was picked (a return, an unticked
 * reserve), and that payload means the same thing today, so it goes through.
 */
export function refuseStaleDayField(
  data: unknown,
  field: "dueAt" | "pickupBy"
): unknown {
  const stale =
    data !== null && typeof data === "object"
      ? (data as Record<string, unknown>)[field]
      : undefined;
  if (stale !== null && stale !== undefined) {
    throw new Error(
      "This page is out of date. Reload it and pick the day again."
    );
  }
  return data;
}

/**
 * The pickup terms staff send with an approval or a reserve (#799), spread
 * into the wire schema beside `SEND_EMAIL_FIELD`.
 *
 * The day and times stay strings for `resolvePickupTerms` to read in the
 * office's zone. Never `z.coerce.date()`: that reads "2026-10-28" as UTC
 * midnight, the evening before in Corvallis (#805). An empty input arrives as
 * "" and means unset, the same as null. The cross-field rules (a time needs a
 * day, both times or neither, the window must not have ended) live in
 * `src/lib/pickup-window.ts`, where the unit test can reach them.
 */
export const PICKUP_FIELDS = {
  pickupDay: OFFICE_DAY_FIELD,
  pickupFromTime: z
    .string()
    .regex(TIME_PATTERN)
    .or(z.literal(""))
    .nullable()
    .default(null),
  pickupToTime: z
    .string()
    .regex(TIME_PATTERN)
    .or(z.literal(""))
    .nullable()
    .default(null),
  pickupPlace: z.string().max(200).nullable().default(null),
  pickupNote: z.string().max(2000).nullable().default(null),
};
