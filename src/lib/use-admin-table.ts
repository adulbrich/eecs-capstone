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
type AdminNavigate = (opts: {
  replace?: boolean;
  search: (prev: Record<string, unknown>) => Record<string, unknown>;
}) => unknown;

interface UseAdminTableOptions<TRow, TColumn extends AdminTableStateColumn> {
  columns: TColumn[];
  /** The rows to render. Also what fixes `TRow` for `getRowId`. */
  data: TRow[];
  defaultSort: SortState;
  getRowId: (row: TRow) => string;
  /**
   * The route's own `useNavigate({ from })` result. Taken as an argument
   * rather than called here: `useNavigate` is generic over the route tree, so
   * calling it inside a generic hook needs casts, while the one line in the
   * route typechecks against the real route path.
   */
  navigate: AdminNavigate;
  /**
   * Send a sort change back to page one. Set it on a paginated listing: the
   * server returns a newly ordered set, so the page the reader was on no
   * longer names the same rows.
   *
   * Deliberately separate from `serverSorted` rather than derived from it.
   * They coincide on the only route that sets either, but server-ordered does
   * not imply paginated, and a route that was one without the other would get
   * a stray `page: 1` pushed into a search schema with no `page` in it.
   */
  resetPageOnSort?: boolean;
  search: AdminTableSearch;
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
 * `data`, `getRowId` and `serverSorted` are different: the hook reads none of
 * them, and forwards all three into `tableProps` untouched. That is deliberate
 * and was weighed in #97 rather than left to be re-noticed at each review.
 *
 * They stay because `data` is not pure forwarding. It is what fixes `TRow` so
 * `getRowId` infers, since `orderRows` is generic over its own export row type
 * and cannot anchor it, and dropping it means annotating the row type at all
 * seven call sites. `getRowId` has to travel with it: it genuinely varies, and
 * not only in the way the six `(row) => row.id` sites suggest, because
 * `/admin/inventory/requests` keys on `row.line.id`. And a complete prop bag is
 * what lets a route write `<AdminDataTable caption emptyMessage {...tableProps}
 * />`; dropping two options puts two props back into seven JSX blocks, so the
 * line count roughly cancels.
 */
export function useAdminTable<TRow, TColumn extends AdminTableStateColumn>({
  columns,
  data,
  defaultSort,
  getRowId,
  navigate,
  resetPageOnSort,
  search,
  serverSorted,
  storageKey,
}: UseAdminTableOptions<TRow, TColumn>) {
  const setSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({
        search: (prev: Record<string, unknown>) => ({
          ...prev,
          ...patch,
          ...(resetPageOnSort && ("sort" in patch || "dir" in patch)
            ? { page: 1 }
            : {}),
        }),
      }),
    [navigate, resetPageOnSort]
  );

  const replaceSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({
        replace: true,
        search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
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
   * Generic over its own row type rather than reusing `TRow`: an export is a
   * wider projection of the same records under the same filters, keyed by the
   * same id but not the same shape.
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
      data,
      defaultSort,
      getRowId,
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
