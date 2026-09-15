import { z } from "zod";

/**
 * The per-action email skip a staff member sends with a write that would
 * email someone (#379). Defaults true so a partial caller sends mail rather
 * than silently swallowing it; a non-staff caller's `false` is ignored by the
 * `*As` function, never by the schema (QUIRKS, "`sendEmail` is decided by
 * role"). Spread into the wire schema; the `*ForCurrentUser` wrapper moves it
 * into `EmailOptions`, so the row-writing input never carries it.
 */
export const SEND_EMAIL_FIELD = { sendEmail: z.boolean().default(true) };
