/**
 * The one place an email address is normalized before it is stored.
 *
 * Four columns hold an address this app writes: `inventory_items`
 * `current_holder_email`, `inventory_item_status_history.holder_email`, and
 * `projects` `proposer_email` and `mentor_email`. Every one of them is
 * lowercase, and this function is what makes that true. [ADR-0015](../../docs/adr/0015-addresses-are-normalized-on-write.md)
 * is the decision and what it costs; `docs/QUIRKS.md` carries the mechanics.
 *
 * `user.email` is NOT one of those columns, and this function must never be
 * the reason someone drops a `lower()` from a comparison against it. Better
 * Auth normalizes that column itself, in 1.6.25, and at two layers:
 * `api/routes/sign-up.mjs:165`, `oauth2/link-account.mjs:101` and the admin
 * plugin's `routes.mjs:191` each lowercase before calling, and
 * `db/internal-adapter.mjs` lowercases again inside `createUser` and
 * `createOAuthUser`, so the invariant does not rest on any one caller.
 * So those folds are defensive rather than load-bearing, and they stay
 * defensive: that is a library's internals, not a contract it publishes, and
 * an upgrade changing it would silently stop linking accounts.
 *
 * Trimming as well as lowercasing, because a trailing space is the same class
 * of thing as a capital letter: an artefact of typing rather than part of the
 * address. Only one of the three write paths trimmed before this
 * (`updateProjectMentorshipAs`); the proposer writes and `holdToColumns`
 * stored the string as given, so trimming is a small behavior change here
 * rather than a tidy-up of something already true.
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
