/**
 * The status vocabularies, written once.
 *
 * Each tuple is the single source for one enum: `src/db/schema.ts` hands it
 * to `pgEnum`, and the modules below derive their union from it. Before this,
 * every vocabulary was written out twice with nothing linking the copies, so
 * a value added to one and not the other was either a row Postgres accepts
 * that the app cannot name, or a status the app hands to a column that
 * rejects it at runtime (#102).
 *
 * This module lives in `src/lib` rather than beside the schema on purpose:
 * `src/lib` is pure and client-safe, and deriving these unions from
 * `schema.ts` would pull `drizzle-orm` into the client bundle. Nothing here
 * imports anything, so that stays true by construction.
 *
 * `as const` is what makes it work at both ends. It gives `pgEnum` the
 * `Readonly<[U, ...U[]]>` tuple its overload wants, and it gives the
 * `[number]` index below a union of literals rather than `string`.
 */

export const PROJECT_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "changes_requested",
  "published",
  "archived",
] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const INVENTORY_ITEM_STATUSES = [
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
  "retired",
] as const;

export type ItemStatus = (typeof INVENTORY_ITEM_STATUSES)[number];

export const INVENTORY_REQUEST_ITEM_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "cancelled",
  "returned",
] as const;

export type InventoryRequestItemStatus =
  (typeof INVENTORY_REQUEST_ITEM_STATUSES)[number];

/**
 * Constrains one union to be a subset of another, and resolves to the subset.
 * `Part extends Whole` is the assertion: a member of `Part` that `Whole` does
 * not have fails to compile where the alias is used.
 *
 * A hand-written subset of a vocabulary, like `RequestLineOutcome`, declares
 * itself through it, so a member the whole does not have is a compile error at
 * the declaration rather than a value the column rejects at runtime.
 */
export type SubsetOf<Whole extends string, Part extends Whole> = Part;
