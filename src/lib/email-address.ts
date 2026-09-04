/**
 * The one place an email address is normalized before it is stored.
 *
 * Four columns hold an address this app writes: `inventory_items`
 * `current_holder_email`, `inventory_item_status_history.holder_email`, and
 * `projects` `proposer_email` and `mentor_email`. Every one of them is
 * lowercase, and this function is what makes that true. #249 chose
 * normalizing on write over folding at compare time, after a third
 * comparison site appeared; `docs/QUIRKS.md` under "Addresses are lowercase
 * in the columns we write" records the trade-off, including what it costs.
 *
 * `user.email` is NOT one of those columns, and this function must never be
 * the reason someone drops a `lower()` from a comparison against it. Better
 * Auth normalizes it too, on all three paths that create an account here
 * (`sign-up.mjs`, `generic-oauth/routes.mjs` and the admin plugin's
 * create-user all lowercase before writing, as of 1.6.25), so the folds
 * against `user.email` are defensive rather than load-bearing today. They
 * stay: that is a library's internal behavior, not a contract it publishes,
 * and it would go silently wrong on an upgrade.
 *
 * Trimming as well as lowercasing, because a trailing space is the same class
 * of thing as a capital letter: an artefact of typing rather than part of the
 * address. That matches what the write paths already did by hand.
 */

/**
 * An address in the form the columns store, or null when there is nothing to
 * store. Empty and whitespace-only both collapse to null, matching the
 * `||`-not-`??` rule in `hold.ts`: an empty string is not a value, and
 * storing one blanks a cell that has a holder.
 */
export function normalizeEmailAddress(
  value: string | null | undefined
): string | null {
  const normalized = value?.trim().toLowerCase();
  return normalized || null;
}
