import { z } from "zod";
import { TIME_PATTERN } from "#/lib/day-range";
import { DAY_PATTERN } from "#/lib/report-range";

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
  pickupDay: z
    .string()
    .regex(DAY_PATTERN)
    .or(z.literal(""))
    .nullable()
    .default(null),
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
