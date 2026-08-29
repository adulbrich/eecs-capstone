import { useCallback, useRef } from "react";
import { orderBySortedIds } from "./csv";
import {
  type AdminTableSearch,
  type AdminTableStateColumn,
  type SortState,
  useAdminTableState,
} from "./table-state";

/**
 * The slice of the router's `navigate` this hook uses. Structural so the hook
 * never imports the router.
 */
type AdminNavigate<TSearch> = (opts: {
  replace?: boolean;
  search: (prev: TSearch) => TSearch;
}) => unknown;

interface UseAdminTableOptions<
  TSearch extends AdminTableSearch,
  TColumn extends AdminTableStateColumn,
> {
  columns: TColumn[];
  defaultSort: SortState;
  /**
   * The route's own `useNavigate({ from })` result. Taken as an argument
   * rather than called here: `useNavigate` is generic over the route tree, so
   * calling it inside a generic hook needs casts, while the one line in the
   * route typechecks against the real route path.
   */
  navigate: AdminNavigate<TSearch>;
  /**
   * Send a sort change back to page one. Set it on a paginated listing: the
   * server returns a newly ordered set, so the page the reader was on no
   * longer names the same rows.
   *
   * Deliberately separate from `serverSorted` rather than derived from it.
   * They coincide on the only route that sets either, but server-ordered does
   * not imply paginated.
   *
   * Unsatisfiable unless the route's own search type has a `page`, which is
   * what stops the failure #96 named: a stray `page: 1` pushed into a schema
   * with no `page` in it. Threading `TSearch` through `navigate` does not catch
   * that on its own, because the reducer's return needs a cast either way, and
   * a cast is what silences the check. This is the part that fails.
   *
   * The false branch is a sentence rather than `never` so the compiler prints
   * the reason: "Type 'true' is not assignable to type 'resetPageOnSort needs
   * a `page` ...'". With `never` it reads "not assignable to type 'undefined'",
   * which is true and tells the reader nothing.
   */
  resetPageOnSort?: TSearch extends { page: number }
    ? boolean
    : "resetPageOnSort needs a `page` in this route's search schema";
  search: TSearch;
  /** Passed straight through to the table. See its prop docs. */
  serverSorted?: boolean;
  storageKey: string;
}

/**
 * Everything an admin route needs to drive `AdminDataTable`.
 *
 * This is the router-aware half. `useAdminTableState` in `table-state.ts` is
 * the router-agnostic core and keeps its own unit tests; this only builds the
 * two navigation callbacks it wants, owns the sorted-id ref, and hands back
 * one spreadable prop bag. Splitting them this way is deliberate: the core's
 * docstring makes "router-agnostic" a stated property, and the whole job of
 * this file is to not be that.
 *
 * The prop bag exists because `columns`, `defaultSort` and `storageKey` used
 * to be passed twice, once to the core and once to the table, with nothing
 * linking them. Seven routes times three values is twenty-one agreements that
 * no compiler or test checked, and each one fails quietly: a mismatched
 * `storageKey` writes preferences under one key and clears them under
 * another, a mismatched `defaultSort` makes the URL and the rendered order
 * disagree. Named once here, they cannot disagree.
 *
 * `serverSorted` is the one option this hook takes and never reads: it is
 * passed straight through to the table. It stays because it belongs to the
 * same prop bag as everything else the table needs, not because anything here
 * would break without it. Contrast `resetPageOnSort`, which this hook reads and
 * never forwards: the table has no such prop.
 */
export function useAdminTable<
  TSearch extends AdminTableSearch,
  TColumn extends AdminTableStateColumn,
>({
  columns,
  defaultSort,
  navigate,
  resetPageOnSort,
  search,
  serverSorted,
  storageKey,
}: UseAdminTableOptions<TSearch, TColumn>) {
  const setSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({
        search: (prev: TSearch) =>
          ({
            ...prev,
            ...patch,
            ...(resetPageOnSort && ("sort" in patch || "dir" in patch)
              ? { page: 1 }
              : {}),
            // TypeScript cannot prove a spread over a generic preserves that
            // generic, so the assertion is unavoidable. It is sound here for a
            // reason worth stating: `patch` only ever carries
            // `AdminTableSearch` keys, which `TSearch` is constrained to
            // include, and `page` is only added when `resetPageOnSort` is set,
            // which the option's type only permits when `TSearch` has one.
          }) as TSearch,
      }),
    [navigate, resetPageOnSort]
  );

  const replaceSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({
        replace: true,
        search: (prev: TSearch) => ({ ...prev, ...patch }) as TSearch,
      }),
    [navigate]
  );

  const { hidden, onHiddenChange, onSortChange, sort } = useAdminTableState({
    columns,
    defaultSort,
    replaceSearch,
    search,
    setSearch,
    storageKey,
  });

  // Populated by the table every time its own sorted row order changes. A ref
  // rather than state because the only reader is an export handler at click
  // time, so there is no reason to re-render on every sort.
  const sortedIdsRef = useRef<string[]>([]);
  const onSortedIdsChange = useCallback((ids: string[]) => {
    sortedIdsRef.current = ids;
  }, []);

  /**
   * Puts exported rows in the order the table is rendering them, so a CSV
   * matches the screen without the caller restating this table's comparators.
   * A no-op under `serverSorted`, where the rows already arrived ordered and
   * the table reports no ids.
   *
   * Generic over its own row type rather than over the table's: an export is
   * a wider projection of the same records under the same filters, keyed by
   * the same id but not the same shape.
   */
  const orderRows = useCallback(
    <TExport>(rows: readonly TExport[], getId: (row: TExport) => string) =>
      orderBySortedIds(rows, sortedIdsRef.current, getId),
    []
  );

  return {
    orderRows,
    tableProps: {
      columns,
      defaultSort,
      hidden,
      onHiddenChange,
      onSortChange,
      onSortedIdsChange,
      serverSorted,
      sort,
      storageKey,
    },
  };
}
