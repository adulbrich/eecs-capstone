/**
 * The public listings' filters, as the traffic writer stores them in
 * `traffic_events.search`, and when each counts as set. Pure and
 * client-safe: `/admin/traffic` reads the labels and the server builds its
 * filter-use query from the same list.
 *
 * A filter is set when its stored value differs from the listing's schema
 * default. The defaults are written out here rather than imported, because
 * the project filter defaults live in a component module the server must not
 * load; `traffic-filters.test.ts` holds them to `PROJECTS_FILTER_DEFAULTS`
 * and to each route's `validateSearch`.
 */

export type TrafficListing = "/projects" | "/inventory";

export type TrafficFilterTest =
  /** A string the reader typed or chose: set when present and not empty. */
  | { kind: "text" }
  /** An array: set when it has any entry. */
  | { kind: "list" }
  /** A nullable choice: set when present and not null. */
  | { kind: "choice" }
  /** A switch: set when it differs from its default. */
  | { kind: "switch"; default: boolean }
  /** An enum where one value is the one worth counting. */
  | { kind: "equals"; value: string };

export interface TrafficFilter {
  key: string;
  label: string;
  test: TrafficFilterTest;
}

export const TRAFFIC_FILTERS: Record<TrafficListing, readonly TrafficFilter[]> =
  {
    "/projects": [
      { key: "q", label: "Typed a search", test: { kind: "text" } },
      { key: "categories", label: "Category", test: { kind: "list" } },
      { key: "program", label: "Program", test: { kind: "choice" } },
      {
        key: "acceptingOnly",
        label: "Show full teams (accepting only off)",
        test: { kind: "switch", default: true },
      },
      {
        key: "archivedOnly",
        label: "Archived only",
        test: { kind: "switch", default: false },
      },
      {
        key: "studentProposedOnly",
        label: "Student proposed only",
        test: { kind: "switch", default: false },
      },
      {
        key: "requiresNdaOnly",
        label: "Requires an NDA only",
        test: { kind: "switch", default: false },
      },
      { key: "order", label: "Chose a sort order", test: { kind: "choice" } },
      {
        key: "view",
        label: "Table view",
        test: { kind: "equals", value: "table" },
      },
    ],
    "/inventory": [
      { key: "q", label: "Typed a search", test: { kind: "text" } },
      { key: "categories", label: "Category", test: { kind: "list" } },
      { key: "status", label: "Status", test: { kind: "choice" } },
      {
        key: "view",
        label: "Table view",
        test: { kind: "equals", value: "table" },
      },
    ],
  };

export const TRAFFIC_LISTINGS = Object.keys(
  TRAFFIC_FILTERS
) as TrafficListing[];
