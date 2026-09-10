/**
 * The `open | closed | all` filter on `/my/items`.
 *
 * Pure and client-safe, like the five inventory modules beside it. The
 * filter is derived rather than a raw status, because the rows it runs over
 * do not share one: a borrow-list row has no line yet, a hold has an item
 * status and no line, and a request row has a line status. One rule here
 * says which of them count as still open.
 *
 * Open is anything the viewer can still act on or is still waiting on: the
 * borrow list, a pending or approved request line, a pending or sourcing
 * custom line, an item held right now. Closed is a line that ended, which
 * for a custom line includes fulfilled: the thing exists, and the hold it
 * produced is its own open row.
 */

import { isOpenCustomLine } from "./inventory-custom-workflow";

/**
 * Open first, so a bare `/my/items` lands on what still matters. A tuple
 * rather than a union, because the route's search schema builds its enum
 * from it and the select renders it in this order.
 */
export const MY_ITEMS_FILTERS = ["open", "closed", "all"] as const;

export type MyItemsFilter = (typeof MY_ITEMS_FILTERS)[number];

/**
 * The shape the rule reads: the kind, a line status where there is one, and
 * on a hold the custom line that produced it, when one did.
 */
export type MyItemsFilterRow =
  | { kind: "cart" }
  | { kind: "hold"; viaCustomLineId?: string | null }
  | { kind: "request"; line: { status: string } }
  | { kind: "custom"; line: { id: string; status: string } };

export function isOpenRow(row: MyItemsFilterRow): boolean {
  switch (row.kind) {
    case "cart":
    case "hold":
      return true;
    case "request":
      return row.line.status === "pending" || row.line.status === "approved";
    case "custom":
      return isOpenCustomLine(row.line.status);
    default: {
      const unhandled: never = row;
      throw new Error(`No filter rule for ${JSON.stringify(unhandled)}`);
    }
  }
}

/**
 * The rows the filter shows, in their given order, plus the custom line each
 * shown hold hangs from. A fulfilled line is closed while the item it
 * reserved is open, so under the default filter the item would otherwise
 * appear with nothing above it saying which request produced it.
 */
export function filterMyItems<T extends MyItemsFilterRow>(
  rows: readonly T[],
  filter: MyItemsFilter
): T[] {
  const shown = new Set(
    rows.filter((row) => matchesMyItemsFilter(row, filter))
  );
  for (const row of [...shown]) {
    if (row.kind !== "hold" || !row.viaCustomLineId) {
      continue;
    }
    const parent = rows.find(
      (candidate) =>
        candidate.kind === "custom" && candidate.line.id === row.viaCustomLineId
    );
    if (parent) {
      shown.add(parent);
    }
  }
  return rows.filter((row) => shown.has(row));
}

export function matchesMyItemsFilter(
  row: MyItemsFilterRow,
  filter: MyItemsFilter
): boolean {
  if (filter === "all") {
    return true;
  }
  return isOpenRow(row) === (filter === "open");
}
