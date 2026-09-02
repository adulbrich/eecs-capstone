/**
 * Who may see which inventory items, and what of them.
 *
 * The counterpart to `src/lib/project-visibility.ts`, and pure and client-safe
 * for the same reason: every one of these decisions used to live inside a
 * 1600-line server-only file that no unit test could import.
 *
 * The projection strategy here is deliberately **not** the projects one.
 * Projects returns the whole row and nulls the private fields, which is why
 * `docs/QUIRKS.md` needs an entry warning that a new staff-only column leaks
 * unless someone remembers to strip it. `publicItemView` builds its result
 * field by field, so a new column cannot ride the payload by default. What
 * inventory was missing was not the strategy, it was this seam.
 *
 * Input types are structural rather than the Drizzle row type, following
 * `project-visibility.ts`, which is what keeps this importable from the
 * client.
 */

import { type Hold, holdEmail, holdName } from "./hold";
import { isStaff, type Viewer } from "./viewer";

export type ItemStatus =
  | "available"
  | "requested"
  | "reserved"
  | "checked_out"
  | "maintenance"
  | "retired";

/**
 * Every status except retired: the working set of items.
 *
 * Retired is the archive. It is excluded from every listing by default, for
 * staff as well, and reachable only through the retired-only filter.
 */
export const ACTIVE_STATUSES: ItemStatus[] = [
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
];

/**
 * Where a status sits in the lifecycle, for a table that sorts by it:
 * available first, then the states an item moves through. Alphabetical order
 * means nothing to a reader. Retired, and anything unknown, sorts last.
 */
export function statusRank(status: string): number {
  const index = ACTIVE_STATUSES.indexOf(status as ItemStatus);
  return index === -1 ? ACTIVE_STATUSES.length : index;
}

/**
 * The one rule about retired items, from which the two below derive.
 *
 * Before this module there were two rules and they disagreed: the SQL scope
 * hid retired from staff as well, while the detail gate let staff read one. So
 * staff could open a retired item by URL and had no way to find one, which
 * matters because they are told to retire anything that has been requested and
 * hard delete only permits `available` or `retired`.
 */
export function canSeeRetired(viewer: Viewer): boolean {
  return isStaff(viewer);
}

/**
 * The statuses a listing may show this viewer.
 *
 * Data rather than a predicate on purpose: this has to cross into SQL, and a
 * list of statuses can while a function cannot. `buildInventoryScope` builds
 * its `inArray` from this, so the query and the single-row gate below cannot
 * drift apart the way the two hand-written rules did.
 *
 * `retiredOnly` is ignored for a viewer who may not see retired at all. The
 * public schema does not carry the flag, so a request would have to defeat
 * two independent things to reach a retired row.
 */
export function visibleStatuses(
  viewer: Viewer,
  opts?: { retiredOnly?: boolean }
): ItemStatus[] {
  if (opts?.retiredOnly && canSeeRetired(viewer)) {
    return ["retired"];
  }
  return ACTIVE_STATUSES;
}

/**
 * Whether this viewer may read one particular item.
 *
 * A different question from `visibleStatuses`, not a contradiction of it: a
 * listing decides what to show by default, this decides whether a person may
 * read the row in front of them. Staff opening a retired item by URL is
 * correct and always was; what was broken is that no listing could produce
 * that URL.
 */
export function canReadInventoryItem(
  item: { status: string },
  viewer: Viewer
): boolean {
  return item.status !== "retired" || canSeeRetired(viewer);
}

export interface ItemCategory {
  id: string;
  name: string;
}

/** The columns both views read, named structurally rather than by import. */
export interface InventoryItemRow {
  createdAt: Date;
  currentDueAt: Date | null;
  currentHolderId: string | null;
  currentHolderLabel: string | null;
  currentHolderProgram: string | null;
  currentPickupBy: Date | null;
  currentRequestItemId: string | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  label: string | null;
  location: string | null;
  name: string;
  notes: string | null;
  serial: string | null;
  status: string;
  updatedAt: Date;
}

export interface InventoryItemPublic {
  categories: ItemCategory[];
  description: string | null;
  dueAt: Date | null;
  id: string;
  imageUrl: string | null;
  name: string;
  pickupBy: Date | null;
  status: string;
}

export type InventoryItemStaff = InventoryItemPublic & {
  createdAt: Date;
  currentHolderEmail: string | null;
  currentHolderId: string | null;
  currentHolderLabel: string | null;
  currentHolderName: string | null;
  currentHolderProgram: string | null;
  currentRequestItemId: string | null;
  label: string | null;
  location: string | null;
  notes: string | null;
  serial: string | null;
  updatedAt: Date;
};

/**
 * The `/my/items` views.
 *
 * A third read path for the same table. These exist rather than reusing
 * `publicItemView` because that one requires a categories argument fed by a
 * correlated subquery this path does not run, and `/my/items` renders neither
 * categories nor a description.
 *
 * `status` is the enum here rather than `string`, so the page does not have to
 * cast it back to a union it already had.
 */
export type HoldItemRow = Omit<InventoryItemRow, "status"> & {
  status: ItemStatus;
};

export interface HoldItemView {
  dueAt: Date | null;
  id: string;
  name: string;
  pickupBy: Date | null;
  status: ItemStatus;
  updatedAt: Date;
}

/** Every column on a request line, so the narrowing below is visible. */
export interface RequestLineRow {
  closedAt: Date | null;
  closedBy: string | null;
  closedReason: string | null;
  createdAt: Date;
  dueAt: Date | null;
  id: string;
  itemId: string;
  pickupBy: Date | null;
  requestId: string;
  reviewComment: string | null;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  status: string;
  updatedAt: Date;
}

export interface MyRequestLineView {
  closedReason: string | null;
  createdAt: Date;
  dueAt: Date | null;
  id: string;
  pickupBy: Date | null;
  status: string;
}

/**
 * What anyone may see. Every field is named here, which is the property worth
 * keeping: adding a column to `inventory_items` cannot leak through this
 * payload, because nothing copies the row wholesale.
 */
export function publicItemView(
  row: InventoryItemRow,
  categories: ItemCategory[]
): InventoryItemPublic {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categories,
    imageUrl: row.imageUrl,
    status: row.status,
    // The hold's dates live on the item itself, so they are the same whether
    // the hold came from a cart request or from staff assigning it directly.
    pickupBy: row.currentPickupBy,
    dueAt: row.currentDueAt,
  };
}

/**
 * What staff may see: the public view plus the private columns.
 *
 * Only the holder's address and name come from the hold, because only those
 * two are reconciled against a joined account. The other three holder columns
 * are the row's own and pass straight through.
 */
export function staffItemView(
  row: InventoryItemRow,
  categories: ItemCategory[],
  hold: Hold
): InventoryItemStaff {
  return {
    ...publicItemView(row, categories),
    createdAt: row.createdAt,
    serial: row.serial,
    label: row.label,
    location: row.location,
    notes: row.notes,
    currentHolderEmail: holdEmail(hold),
    currentHolderName: holdName(hold),
    currentHolderId: row.currentHolderId,
    currentHolderLabel: row.currentHolderLabel,
    currentHolderProgram: row.currentHolderProgram,
    currentRequestItemId: row.currentRequestItemId,
    updatedAt: row.updatedAt,
  };
}

/**
 * What someone holding an item may see about it on their own page.
 *
 * `updatedAt` is here because it is the tie-break in `compareByDeadline`, not
 * because the page renders it.
 */
export function holdItemView(row: HoldItemRow): HoldItemView {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    pickupBy: row.currentPickupBy,
    dueAt: row.currentDueAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * What the requester may see about their own request line.
 *
 * The review columns stay behind. `reviewedBy` names the staff member who
 * decided, and `reviewComment` is the same string as `closedReason`, which is
 * the one the page renders.
 */
export function myRequestLineView(row: RequestLineRow): MyRequestLineView {
  return {
    id: row.id,
    status: row.status,
    pickupBy: row.pickupBy,
    dueAt: row.dueAt,
    createdAt: row.createdAt,
    closedReason: row.closedReason,
  };
}
