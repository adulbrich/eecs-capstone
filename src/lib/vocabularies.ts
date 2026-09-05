/**
 * The closed vocabularies, written once.
 *
 * Each tuple is the single source for one set of legal values, and the
 * modules below derive their union from it. Before this, every vocabulary was
 * written out twice with nothing linking the copies, so a value added to one
 * and not the other was either a row Postgres accepts that the app cannot
 * name, or a status the app hands to a column that rejects it at runtime
 * (#102).
 *
 * The three status tuples are anchored twice over, because `src/db/schema.ts`
 * hands each one to `pgEnum` and the column then refuses anything the tuple
 * does not name. `USER_ROLES` is not: `user.role` is `text`, owned by Better
 * Auth. The tuple is the whole anchor there, which is why it belongs here
 * rather than beside the one consumer that happened to export a list first.
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
 * The roles an account can hold, in ascending order of what they may do.
 *
 * This was written out three times, in three orders, with nothing linking the
 * copies: the analytics breakdown, the wire contract in `src/server/users.ts`
 * and the admin filter dropdown, plus two hand-written unions in the user
 * admin components. A fourth role added to one and not the others is a role
 * nobody can filter by, a role the admin table cannot assign, and a bar
 * missing from the analytics chart, and no type related any two of them
 * (#274).
 *
 * There is no reader's order beside this one. `PROJECT_STATUSES_IN_DISPLAY_ORDER`
 * exists because `pgEnum` pins the status tuple's order in the database and
 * reordering it is a migration, so the order a reader wants has to live
 * somewhere else. Nothing pins this tuple, so its order is the one the admin
 * filter, the role selects and the analytics chart all read.
 *
 * `STAFF_ROLES` in `viewer.ts` is the subset that carries staff powers, and
 * `isAdmin` there is the narrower question still. Neither is derived from
 * this tuple by a rule, because which roles are staff is a judgement rather
 * than a consequence of the list; `STAFF_ROLES` is constrained to be a subset
 * of it, so a role renamed here fails to compile there.
 */
export const USER_ROLES = ["user", "instructor", "admin"] as const;

export type UserRole = (typeof USER_ROLES)[number];

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
