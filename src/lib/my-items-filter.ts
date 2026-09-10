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
 * borrow list, a pending or approved line, an item held right now. Closed is
 * a line that ended. The statuses named here are the ones that exist today;
 * a second kind of line (#80) extends this rule rather than restating it.
 */

/**
 * Open first, so a bare `/my/items` lands on what still matters. A tuple
 * rather than a union, because the route's search schema builds its enum
 * from it and the select renders it in this order.
 */
export const MY_ITEMS_FILTERS = ["open", "closed", "all"] as const;

export type MyItemsFilter = (typeof MY_ITEMS_FILTERS)[number];

/** The shape the rule reads: the kind, and a line status where there is one. */
export type MyItemsFilterRow =
  | { kind: "cart" }
  | { kind: "hold" }
  | { kind: "request"; line: { status: string } };

export function isOpenRow(row: MyItemsFilterRow): boolean {
  switch (row.kind) {
    case "cart":
    case "hold":
      return true;
    case "request":
      return row.line.status === "pending" || row.line.status === "approved";
    default: {
      const unhandled: never = row;
      throw new Error(`No filter rule for ${JSON.stringify(unhandled)}`);
    }
  }
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
