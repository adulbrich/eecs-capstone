import { useCallback, useEffect, useMemo } from "react";

export interface SortState {
  desc: boolean;
  id: string;
}

/**
 * One localStorage key per admin table. Column layout is a per-page
 * preference: someone who hides serials on inventory has said nothing about
 * what they want on projects.
 */
const STORAGE_PREFIX = "cs-capstone:admin-cols:";

/**
 * Reads `?sort=` and `?dir=` into table state, falling back to the page
 * default whenever either is missing or names something the table cannot
 * sort by. A hand-edited URL degrades to the default rather than throwing.
 */
export function parseSort(
  sort: string | undefined,
  dir: string | undefined,
  sortableIds: readonly string[],
  fallback: SortState
): SortState {
  if (!(sort && sortableIds.includes(sort))) {
    return fallback;
  }
  if (dir !== "asc" && dir !== "desc") {
    return fallback;
  }
  return { desc: dir === "desc", id: sort };
}

/**
 * The inverse of `parseSort`. Both params are omitted when the state matches
 * the page default, so an untouched table has a clean URL.
 *
 * The return type spells out `dir`/`sort` as always-present keys holding
 * `undefined`, rather than making them optional. That is load-bearing, not
 * incidental: `useAdminTable`'s `resetPageOnSort` sends a paginated listing
 * back to page 1 by checking `"sort" in patch`, and an optional key that is
 * simply absent when unset would make that check false for a real
 * (default-restoring) sort change, silently breaking the page reset.
 * `use-admin-table.test.tsx` pins that case.
 */
export function serializeSort(
  state: SortState,
  fallback: SortState
): { dir: "asc" | "desc" | undefined; sort: string | undefined } {
  if (state.id === fallback.id && state.desc === fallback.desc) {
    return { dir: undefined, sort: undefined };
  }
  return { dir: state.desc ? "desc" : "asc", sort: state.id };
}

/**
 * Reads `?cols=`, which carries only the hidden columns.
 *
 * Absent and empty mean different things: absent is "I have expressed no
 * preference, use the page default", empty is "I deliberately turned
 * everything on". Collapsing the two would make it impossible to show a
 * column that the page hides by default.
 */
export function parseHidden(
  cols: string | undefined,
  hideableIds: readonly string[],
  fallback: readonly string[]
): string[] {
  if (cols === undefined) {
    return [...fallback];
  }
  if (cols === "") {
    return [];
  }
  return cols.split(",").filter((id) => hideableIds.includes(id));
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((id, i) => id === sortedB[i]);
}

/**
 * The inverse of `parseHidden`. Returns `undefined` (meaning "omit the
 * param") when the hidden set matches the page default. The list is sorted so
 * that toggling a column off and on again produces the same URL it started
 * with.
 */
export function serializeHidden(
  hidden: readonly string[],
  fallback: readonly string[]
): string | undefined {
  if (sameSet(hidden, fallback)) {
    return;
  }
  return [...hidden].sort().join(",");
}

/**
 * Reads the persisted column layout for one page. Returns null when running
 * without a DOM (SSR), when nothing is stored, or when storage throws. An
 * empty array is a real answer and is distinct from null.
 */
export function readStoredHidden(storageKey: string): string[] | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (raw === null) {
      return null;
    }
    return raw === "" ? [] : raw.split(",").sort();
  } catch {
    return null;
  }
}

/** Persists a column layout. A no-op (never throws) when storage is unavailable. */
export function writeStoredHidden(
  storageKey: string,
  hidden: readonly string[]
): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + storageKey,
      [...hidden].sort().join(",")
    );
  } catch {
    // Ignore: storage may be full or disabled (private mode).
  }
}

/**
 * Removes a page's stored column layout entirely, so a later
 * `readStoredHidden` sees `null` ("no preference, use the page default")
 * rather than `[]` ("deliberately show everything") or a literal copy of the
 * default set. That distinction is what `useSeedColumnsFromStorage` branches
 * on: writing the default set instead of clearing it would leave a
 * preference on record, and the seed effect would dutifully write it back
 * into the URL the next time `cols` becomes undefined. A no-op (never
 * throws) when storage is unavailable.
 */
export function clearStoredHidden(storageKey: string): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(STORAGE_PREFIX + storageKey);
  } catch {
    // Ignore: storage may be disabled (private mode).
  }
}

/**
 * Seeds `?cols=` from the persisted layout on first render.
 *
 * The URL stays the source of truth: when the param is present this is a
 * no-op, so a shared link always wins. Only a param-less visit consults
 * storage, through `seed`, which the caller wires to a
 * `navigate({ replace: true })`.
 *
 * `seed` must be referentially stable (wrap it in `useCallback`) or the
 * effect re-runs on every render.
 */
export function useSeedColumnsFromStorage(
  storageKey: string,
  current: string | undefined,
  seed: (cols: string) => void
) {
  useEffect(() => {
    if (current !== undefined) {
      return;
    }
    const stored = readStoredHidden(storageKey);
    if (stored === null) {
      return;
    }
    seed(stored.join(","));
  }, [storageKey, current, seed]);
}

/** The three URL params this hook owns. Routes carry others alongside them. */
export interface AdminTableSearch {
  cols?: string;
  dir?: "asc" | "desc";
  sort?: string;
}

/**
 * The subset of a column definition this hook needs. `AdminColumn` from
 * `admin-data-table.tsx` satisfies it structurally, so routes pass their
 * column list straight through.
 */
export interface AdminTableStateColumn {
  defaultHidden?: boolean;
  enableHiding?: boolean;
  enableSorting?: boolean;
  id: string;
}

interface UseAdminTableStateOptions {
  columns: readonly AdminTableStateColumn[];
  defaultSort: SortState;
  /** Applies a param patch with history replacement, for the storage seed. */
  replaceSearch: (patch: AdminTableSearch) => void;
  search: AdminTableSearch;
  /** Applies a param patch as a normal navigation. */
  setSearch: (patch: AdminTableSearch) => void;
  storageKey: string;
}

/**
 * Everything a route needs to drive `AdminDataTable`, derived from its column
 * list and its URL params.
 *
 * Router-agnostic on purpose: it takes a plain `search` object and two
 * callbacks instead of reaching for `useNavigate`. That keeps it unit-testable
 * and keeps all three admin routes down to a handful of lines each.
 *
 * `columns`, `defaultSort`, `setSearch` and `replaceSearch` must be
 * referentially stable. Define the first two as module constants and wrap the
 * callbacks in `useCallback`, or the seeding effect re-runs every render.
 */
export function useAdminTableState({
  columns,
  defaultSort,
  replaceSearch,
  search,
  setSearch,
  storageKey,
}: UseAdminTableStateOptions) {
  const sortableIds = useMemo(
    () => columns.filter((c) => c.enableSorting !== false).map((c) => c.id),
    [columns]
  );
  const hideableIds = useMemo(
    () => columns.filter((c) => c.enableHiding !== false).map((c) => c.id),
    [columns]
  );
  const defaultHidden = useMemo(
    () => columns.filter((c) => c.defaultHidden).map((c) => c.id),
    [columns]
  );

  const seed = useCallback(
    (cols: string) => replaceSearch({ cols }),
    [replaceSearch]
  );
  useSeedColumnsFromStorage(storageKey, search.cols, seed);

  const onSortChange = useCallback(
    (next: SortState) => setSearch(serializeSort(next, defaultSort)),
    [defaultSort, setSearch]
  );
  const onHiddenChange = useCallback(
    (cols: string | undefined) => setSearch({ cols }),
    [setSearch]
  );

  return {
    hidden: parseHidden(search.cols, hideableIds, defaultHidden),
    onHiddenChange,
    onSortChange,
    sort: parseSort(search.sort, search.dir, sortableIds, defaultSort),
  };
}
