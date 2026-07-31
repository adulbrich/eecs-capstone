# Admin Data Tables Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/admin/inventory`, `/admin/projects`, and `/admin/mentors` on TanStack Table so staff can sort every column, choose which columns are visible, and see far more of each record at once, on desktop tables and mobile cards alike.

**Architecture:** The server decides which rows exist (Postgres filtering and full-text search, in the URL, in `loaderDeps`); the client decides their order and which columns show (TanStack Table state, in the URL, deliberately *not* in `loaderDeps`). One controlled `AdminDataTable` component renders all three pages from per-page column definitions; each route owns its own URL state and filter controls.

**Tech Stack:** TanStack Start + TanStack Router, TanStack Table v8.21, Drizzle ORM + Postgres, Zod v4, React 19, Tailwind v4, shadcn/ui over Radix, Vitest + Testing Library, Playwright + axe.

**Design spec:** `docs/superpowers/specs/2026-07-31-admin-data-tables-design.md`. Read it before starting; it explains *why* for most of what follows.

## Global Constraints

- **Prose contains no emdashes.** Applies to comments, docs, and UI copy. Use other punctuation.
- **No back-compatibility shims.** The app is pre-production. Delete and restructure rather than adding aliases, redirects, or parallel code paths.
- **Run tests with the sandbox disabled** (`dangerouslyDisableSandbox: true` on the Bash call) and raise the fd limit in the same command, or Vitest fails with `EPERM listen` and `EMFILE`.
  - Unit: `ulimit -n 8192; CI=true npm test`
  - Single unit file: `ulimit -n 8192; CI=true npx vitest run <path>`
  - Integration: `ulimit -n 8192; CI=true npm run test:integration`
- **Integration tests truncate every table** in a `beforeEach`. A run wipes dev seed data.
- **Before every commit run the full `npm run check` and `npm run typecheck`**, not a per-file `ultracite check`. CI runs `npm run check` across the whole repo and it includes the formatter, so a line that grew past the width limit fails CI even though a per-file check passed.
- **jsdom component tests declare their environment per file** with `// @vitest-environment jsdom` on line 1.
- **Ultracite/Biome standards apply**: no nested ternaries, `for...of` over `.forEach`, explicit `type="button"` on non-submit buttons, no `any`, arrow callbacks, early returns.
- **The public `/inventory` and `/projects` listings must not change behavior.** They share `listInventory` and `projectSummarySelect` with the admin pages; both stay intact.
- **Staff-only fields must not become publicly searchable.** `serial`, `label`, `location`, and holder identity are staff-visible only, so the widened search predicate belongs exclusively to the admin query.

---

## File Structure

**Created**

| File | Responsibility |
| --- | --- |
| `src/lib/table-state.ts` | Pure codec between URL params / localStorage and table state. No React except one seeding hook. |
| `src/lib/__tests__/table-state.test.ts` | Unit tests for the codec. |
| `src/components/ui/table.tsx` | shadcn table primitives, with four documented local edits. |
| `src/components/admin-data-table.tsx` | The shared controlled table: toolbar, sortable header, `data-label` body, column picker. |
| `src/test/admin-data-table.test.tsx` | jsdom tests for the shared table. |
| `src/server/__tests__/admin-inventory.integration.test.ts` | Integration tests for the admin inventory listing. |

**Modified**

| File | Change |
| --- | --- |
| `src/server/_internal/inventory.ts` | Extract `buildInventoryScope`, add `listAdminInventoryAs`, add `createdAt`/`updatedAt` to staff rows. |
| `src/server/inventory.ts` | Add the `listAdminInventory` server function. |
| `src/server/_internal/project-summary.ts` | Add `adminProjectSummarySelect`. |
| `src/server/_internal/projects-queries.ts` | Join `user` for the proposer, widen the search predicate. |
| `src/server/_internal/users.ts` | Add an optional `q` to `listMentorsAs`. |
| `src/server/users.ts` | Pass `q` through `listMentors`. |
| `src/routes/_authed/admin/inventory/index.tsx` | Rebuild on `AdminDataTable`; drop pagination; wire the category filter. |
| `src/routes/_authed/admin/projects/index.tsx` | Rebuild on `AdminDataTable`; stop using `ProjectRow`. |
| `src/routes/_authed/admin/mentors/index.tsx` | Rebuild on `AdminDataTable`; add search. |
| `src/server/__tests__/admin-projects-filter.integration.test.ts` | Cover the widened search and the left join. |
| `src/test/a11y/admin.a11y.test.ts` | Add an interaction pass on the inventory table. |

**Deleted**

| File | Reason |
| --- | --- |
| ~~`src/components/admin-table.tsx`~~ | **Not deleted.** This row was wrong. `AdminTable` still has three consumers after Task 7: `/admin/programs`, `/admin/users`, and `/admin/categories`. It stays until those pages migrate, which the project backlog records as separate future work. |

**Untouched on purpose:** `src/styles.css` (the `.admin-table` mobile card rules keep working as-is), `src/components/project-row.tsx` (still used by the public listing through `project-list-item.tsx`), `src/lib/view-preference.ts`.

---

## Task 1: The table-state codec

**Files:**
- Create: `src/lib/table-state.ts`
- Test: `src/lib/__tests__/table-state.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `interface SortState { desc: boolean; id: string }`; `parseSort(sort, dir, sortableIds, fallback): SortState`; `serializeSort(state, fallback): { dir?: "asc" | "desc"; sort?: string }`; `parseHidden(cols, hideableIds, fallback): string[]`; `serializeHidden(hidden, fallback): string | undefined`; `readStoredHidden(storageKey): string[] | null`; `writeStoredHidden(storageKey, hidden): void`; `useSeedColumnsFromStorage(storageKey, current, seed): void`; and the hook all three routes use, `useAdminTableState({ columns, defaultSort, replaceSearch, search, setSearch, storageKey }): { hidden, onHiddenChange, onSortChange, sort }`.

The hook exists so the three routes do not each repeat the same wiring. It is deliberately router-agnostic: it takes a plain `search` object and two callbacks rather than importing `useNavigate`, which is what makes it unit-testable here and keeps each route down to a few lines.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/__tests__/table-state.test.ts`:

```ts
// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  parseHidden,
  parseSort,
  readStoredHidden,
  serializeHidden,
  serializeSort,
  useSeedColumnsFromStorage,
  writeStoredHidden,
} from "#/lib/table-state";

const SORTABLE = ["name", "status", "updatedAt"] as const;
const HIDEABLE = ["serial", "label", "updatedAt"] as const;
const FALLBACK = { desc: true, id: "updatedAt" } as const;

afterEach(() => {
  localStorage.clear();
});

describe("parseSort", () => {
  it("reads a valid column and direction", () => {
    expect(parseSort("name", "asc", SORTABLE, FALLBACK)).toEqual({
      desc: false,
      id: "name",
    });
  });

  it("falls back when the column is not sortable", () => {
    expect(parseSort("nope", "asc", SORTABLE, FALLBACK)).toEqual(FALLBACK);
  });

  it("falls back when the direction is not asc or desc", () => {
    expect(parseSort("name", "sideways", SORTABLE, FALLBACK)).toEqual(FALLBACK);
  });

  it("falls back when the params are absent", () => {
    expect(parseSort(undefined, undefined, SORTABLE, FALLBACK)).toEqual(
      FALLBACK
    );
  });
});

describe("serializeSort", () => {
  it("omits both params when the sort matches the page default", () => {
    expect(serializeSort({ desc: true, id: "updatedAt" }, FALLBACK)).toEqual({
      dir: undefined,
      sort: undefined,
    });
  });

  it("emits both params when the sort differs from the default", () => {
    expect(serializeSort({ desc: false, id: "name" }, FALLBACK)).toEqual({
      dir: "asc",
      sort: "name",
    });
  });

  it("round-trips through parseSort", () => {
    const state = { desc: true, id: "status" };
    const { dir, sort } = serializeSort(state, FALLBACK);
    expect(parseSort(sort, dir, SORTABLE, FALLBACK)).toEqual(state);
  });
});

describe("parseHidden", () => {
  it("returns the page default when the param is absent", () => {
    expect(parseHidden(undefined, HIDEABLE, ["serial"])).toEqual(["serial"]);
  });

  it("treats an empty param as an explicit choice to show everything", () => {
    expect(parseHidden("", HIDEABLE, ["serial"])).toEqual([]);
  });

  it("drops ids that are not hideable columns", () => {
    expect(parseHidden("serial,bogus", HIDEABLE, [])).toEqual(["serial"]);
  });
});

describe("serializeHidden", () => {
  it("omits the param when the hidden set matches the default", () => {
    expect(serializeHidden(["label", "serial"], ["serial", "label"])).toBe(
      undefined
    );
  });

  it("emits a sorted list when the hidden set differs", () => {
    expect(serializeHidden(["serial", "label"], [])).toBe("label,serial");
  });

  it("emits an empty string when everything is shown but the default hides some", () => {
    expect(serializeHidden([], ["serial"])).toBe("");
  });
});

describe("stored columns", () => {
  it("round-trips a hidden set", () => {
    writeStoredHidden("inventory", ["serial", "label"]);
    expect(readStoredHidden("inventory")).toEqual(["label", "serial"]);
  });

  it("keeps pages separate", () => {
    writeStoredHidden("inventory", ["serial"]);
    expect(readStoredHidden("projects")).toBeNull();
  });

  it("returns null when nothing is stored", () => {
    expect(readStoredHidden("inventory")).toBeNull();
  });

  it("distinguishes a stored empty set from nothing stored", () => {
    writeStoredHidden("inventory", []);
    expect(readStoredHidden("inventory")).toEqual([]);
  });
});

describe("useSeedColumnsFromStorage", () => {
  it("seeds from storage when the param is absent", () => {
    writeStoredHidden("inventory", ["serial"]);
    const seed = vi.fn();
    renderHook(() => useSeedColumnsFromStorage("inventory", undefined, seed));
    expect(seed).toHaveBeenCalledWith("serial");
  });

  it("does not seed when the param is already present", () => {
    writeStoredHidden("inventory", ["serial"]);
    const seed = vi.fn();
    renderHook(() => useSeedColumnsFromStorage("inventory", "label", seed));
    expect(seed).not.toHaveBeenCalled();
  });

  it("does not seed when nothing is stored", () => {
    const seed = vi.fn();
    renderHook(() => useSeedColumnsFromStorage("inventory", undefined, seed));
    expect(seed).not.toHaveBeenCalled();
  });
});

describe("useAdminTableState", () => {
  const COLUMNS = [
    { enableHiding: false, id: "name" },
    { id: "status" },
    { defaultHidden: true, id: "serial" },
    { enableSorting: false, id: "actions" },
  ];

  function setup(search: Record<string, string | undefined> = {}) {
    const replaceSearch = vi.fn();
    const setSearch = vi.fn();
    const { result } = renderHook(() =>
      useAdminTableState({
        columns: COLUMNS,
        defaultSort: FALLBACK,
        replaceSearch,
        search,
        setSearch,
        storageKey: "inventory",
      })
    );
    return { replaceSearch, result, setSearch };
  }

  it("derives the default sort and hidden set from the columns", () => {
    const { result } = setup();
    expect(result.current.sort).toEqual(FALLBACK);
    expect(result.current.hidden).toEqual(["serial"]);
  });

  it("reads sort and visibility out of the search object", () => {
    const { result } = setup({ cols: "status", dir: "asc", sort: "status" });
    expect(result.current.sort).toEqual({ desc: false, id: "status" });
    expect(result.current.hidden).toEqual(["status"]);
  });

  it("ignores a sort on a column that cannot be sorted", () => {
    const { result } = setup({ dir: "asc", sort: "actions" });
    expect(result.current.sort).toEqual(FALLBACK);
  });

  it("pushes a sort change back through setSearch", () => {
    const { result, setSearch } = setup();
    result.current.onSortChange({ desc: false, id: "name" });
    expect(setSearch).toHaveBeenCalledWith({ dir: "asc", sort: "name" });
  });

  it("clears both params when the sort returns to the default", () => {
    const { result, setSearch } = setup({ dir: "asc", sort: "name" });
    result.current.onSortChange(FALLBACK);
    expect(setSearch).toHaveBeenCalledWith({ dir: undefined, sort: undefined });
  });

  it("pushes a visibility change back through setSearch", () => {
    const { result, setSearch } = setup();
    result.current.onHiddenChange("status");
    expect(setSearch).toHaveBeenCalledWith({ cols: "status" });
  });

  it("seeds the cols param from storage through replaceSearch", () => {
    writeStoredHidden("inventory", ["status"]);
    const { replaceSearch } = setup();
    expect(replaceSearch).toHaveBeenCalledWith({ cols: "status" });
  });

  it("does not seed when the cols param is already set", () => {
    writeStoredHidden("inventory", ["status"]);
    const { replaceSearch } = setup({ cols: "serial" });
    expect(replaceSearch).not.toHaveBeenCalled();
  });
});
```

Add `useAdminTableState` to the import list at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run (sandbox disabled): `ulimit -n 8192; CI=true npx vitest run src/lib/__tests__/table-state.test.ts`
Expected: FAIL, cannot resolve `#/lib/table-state`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/table-state.ts`:

```ts
import { useEffect } from "react";

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
  if (!sort || !sortableIds.includes(sort)) {
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
    return undefined;
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
```

Change the React import on line 1 to `import { useCallback, useEffect, useMemo } from "react";`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `ulimit -n 8192; CI=true npx vitest run src/lib/__tests__/table-state.test.ts`
Expected: PASS, 25 tests.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npm run check && npm run typecheck
git add src/lib/table-state.ts src/lib/__tests__/table-state.test.ts
git commit -m "feat(admin): add the URL and storage codec for table state"
```

---

## Task 2: The shared AdminDataTable

**Files:**
- Create: `src/components/ui/table.tsx` (via `npx shadcn@latest add table`, then edited)
- Create: `src/components/admin-data-table.tsx`
- Test: `src/test/admin-data-table.test.tsx`

**Interfaces:**
- Consumes: everything from Task 1.
- Produces: `type AdminColumn<T> = ColumnDef<T, unknown> & { defaultHidden?: boolean; header: string; id: string }` and the `AdminDataTable` component with this exact prop set:

```ts
// Exported, not local: the tests type their prop overrides against it.
export interface AdminDataTableProps<T> {
  caption: string;
  columns: AdminColumn<T>[];
  data: T[];
  defaultSort: SortState;
  emptyMessage: string;
  getRowId: (row: T) => string;
  hidden: string[];
  onHiddenChange: (cols: string | undefined) => void;
  onSortChange: (sort: SortState) => void;
  sort: SortState;
  storageKey: string;
  toolbar?: ReactNode;
}
```

The component is **controlled**: it never touches the router. Routes own the URL and pass `sort`/`hidden` down and `onSortChange`/`onHiddenChange` up. That is what lets the tests below render it in plain jsdom with no router. The component does write `localStorage` itself when visibility changes, mirroring how `view-toggle.tsx` persists on toggle.

- [ ] **Step 1: Add the shadcn table primitive**

```bash
npx shadcn@latest add table
```

If the CLI fails on an npm cache permission error, create `src/components/ui/table.tsx` by hand from `https://ui.shadcn.com/r/styles/new-york-v4/table.json`, changing its `@/lib/utils` import to `#/lib/utils`.

- [ ] **Step 2: Apply the four required edits to `src/components/ui/table.tsx`**

Each edit has a reason; record it as a comment so a later reader does not "fix" it back.

1. `Table`'s wrapper div: replace `className="relative w-full overflow-x-auto"` with `className="relative w-full md:max-h-[calc(100vh-14rem)] md:overflow-auto"`. Below `md` the table is restacked into cards by `src/styles.css`, so it must not be a scroll container there; above `md` the height constraint is what gives the sticky header something to stick to.
2. `TableHead` and `TableCell`: replace `whitespace-nowrap` with `whitespace-normal md:whitespace-nowrap`. Cards need wrapping text; table rows do not.
3. `Table`'s inner `<table>`: add `border-separate border-spacing-0` to its class list. `position: sticky` on a `th` does not hold under `border-collapse: collapse`.
4. `TableRow`: remove `border-b` from its class list, and add `border-b` to both `TableHead` and `TableCell`. In the separated border model a `<tr>` cannot paint a border at all, so edit 3 would silently erase every row rule otherwise. Cell borders are also what `src/styles.css` reuses as the card's internal dividers.

Add this comment above the `Table` function:

```tsx
/**
 * shadcn's table, with four local edits. The component is copy-owned, so
 * these divergences are permanent and deliberate:
 *
 * 1. The wrapper scrolls (and caps its height) only at `md` and up, because
 *    below that `src/styles.css` restacks `.admin-table` into cards and a
 *    scroll container would fight it.
 * 2. Cells wrap below `md` and stay on one line above it, for the same reason.
 * 3. The table is `border-separate`, which sticky headers require.
 * 4. The row rule lives on the cells, not on `TableRow`, because a `tr`
 *    cannot paint a border once the table is `border-separate`.
 */
```

- [ ] **Step 3: Write the failing tests**

Create `src/test/admin-data-table.test.tsx`:

```tsx
// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type AdminColumn,
  AdminDataTable,
  type AdminDataTableProps,
} from "#/components/admin-data-table";

interface Row {
  id: string;
  location: string | null;
  name: string;
}

const DATA: Row[] = [
  { id: "1", location: "Lab 2", name: "beta" },
  { id: "2", location: null, name: "Alpha" },
  { id: "3", location: "Lab 1", name: "gamma" },
];

const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.name,
    cell: (ctx) => ctx.row.original.name,
    enableHiding: false,
    header: "Name",
    id: "name",
  },
  {
    accessorFn: (row) => row.location ?? undefined,
    cell: (ctx) => ctx.row.original.location ?? "-",
    defaultHidden: true,
    header: "Location",
    id: "location",
    sortUndefined: "last",
  },
];

const DEFAULT_SORT = { desc: false, id: "name" } as const;

function renderTable(overrides: Partial<AdminDataTableProps<Row>> = {}) {
  return render(
    <AdminDataTable
      caption="Test items"
      columns={COLUMNS}
      data={DATA}
      defaultSort={DEFAULT_SORT}
      emptyMessage="Nothing here."
      getRowId={(row) => row.id}
      hidden={["location"]}
      onHiddenChange={vi.fn()}
      onSortChange={vi.fn()}
      sort={DEFAULT_SORT}
      storageKey="test"
      {...overrides}
    />
  );
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("AdminDataTable", () => {
  it("names the table with a caption as the table's first child", () => {
    const { container } = renderTable();
    const table = container.querySelector("table");
    expect(table?.firstElementChild?.tagName).toBe("CAPTION");
    expect(table?.firstElementChild?.textContent).toBe("Test items");
  });

  it("marks the sorted column with aria-sort and leaves others none", () => {
    renderTable();
    expect(screen.getByRole("columnheader", { name: /Name/ })).toHaveAttribute(
      "aria-sort",
      "ascending"
    );
  });

  it("reports a sort change when a header button is activated", () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange });
    screen.getByRole("button", { name: /Name/ }).click();
    expect(onSortChange).toHaveBeenCalledWith({ desc: true, id: "name" });
  });

  it("hides a column's header and every one of its cells", () => {
    renderTable();
    expect(
      screen.queryByRole("columnheader", { name: /Location/ })
    ).toBeNull();
    expect(screen.queryByText("Lab 2")).toBeNull();
  });

  it("labels every body cell with its column header, for the mobile cards", () => {
    const { container } = renderTable({ hidden: [] });
    const firstRow = container.querySelectorAll("tbody tr")[0];
    const labels = [...firstRow.querySelectorAll("td")].map((td) =>
      td.getAttribute("data-label")
    );
    expect(labels).toEqual(["Name", "Location"]);
  });

  it("reports the new hidden set and persists it when a column is toggled", () => {
    const onHiddenChange = vi.fn();
    renderTable({ hidden: [], onHiddenChange });
    screen.getByRole("button", { name: "Columns" }).click();
    screen.getByRole("menuitemcheckbox", { name: "Location" }).click();
    expect(onHiddenChange).toHaveBeenCalledWith("location");
    expect(localStorage.getItem("cs-capstone:admin-cols:test")).toBe(
      "location"
    );
  });

  it("offers no checkbox for a column that cannot be hidden", () => {
    renderTable();
    screen.getByRole("button", { name: "Columns" }).click();
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Name" })
    ).toBeNull();
  });

  it("renders the empty message instead of a table when there are no rows", () => {
    renderTable({ data: [] });
    expect(screen.getByText("Nothing here.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the toolbar visible when there are no rows", () => {
    renderTable({ data: [], toolbar: <p>Filters go here</p> });
    expect(screen.getByText("Filters go here")).toBeInTheDocument();
  });

  it("announces the row count in a live region", () => {
    renderTable();
    expect(screen.getByText("3 rows")).toBeInTheDocument();
  });

  it("sorts text case-insensitively", () => {
    const { container } = renderTable();
    const names = [...container.querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelector("td")?.textContent
    );
    // Capitalized "Alpha" must interleave with the lowercase names rather
    // than sorting ahead of all of them on its byte value.
    expect(names).toEqual(["Alpha", "beta", "gamma"]);
  });

  it("sorts nulls last regardless of direction", () => {
    const { container, rerender } = render(
      <AdminDataTable
        caption="Test items"
        columns={COLUMNS}
        data={DATA}
        defaultSort={DEFAULT_SORT}
        emptyMessage="Nothing here."
        getRowId={(row) => row.id}
        hidden={[]}
        onHiddenChange={vi.fn()}
        onSortChange={vi.fn()}
        sort={{ desc: false, id: "location" }}
        storageKey="test"
      />
    );
    const ascending = [...container.querySelectorAll("tbody tr")].map(
      (tr) => within(tr as HTMLElement).getAllByRole("cell")[1].textContent
    );
    expect(ascending).toEqual(["Lab 1", "Lab 2", "-"]);

    rerender(
      <AdminDataTable
        caption="Test items"
        columns={COLUMNS}
        data={DATA}
        defaultSort={DEFAULT_SORT}
        emptyMessage="Nothing here."
        getRowId={(row) => row.id}
        hidden={[]}
        onHiddenChange={vi.fn()}
        onSortChange={vi.fn()}
        sort={{ desc: true, id: "location" }}
        storageKey="test"
      />
    );
    const descending = [...container.querySelectorAll("tbody tr")].map(
      (tr) => within(tr as HTMLElement).getAllByRole("cell")[1].textContent
    );
    expect(descending).toEqual(["Lab 2", "Lab 1", "-"]);
  });
});
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `ulimit -n 8192; CI=true npx vitest run src/test/admin-data-table.test.tsx`
Expected: FAIL, cannot resolve `#/components/admin-data-table`.

- [ ] **Step 5: Write the implementation**

Create `src/components/admin-data-table.tsx`:

```tsx
import {
  type ColumnDef,
  type ColumnSort,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type SortingState,
  useReactTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { ChevronDown, ChevronsUpDown, ChevronUp, Columns3 } from "lucide-react";
import { type ReactNode, useMemo } from "react";
import { EmptyState } from "#/components/empty-state";
import { Button } from "#/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "#/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "#/components/ui/table";
import {
  serializeHidden,
  type SortState,
  writeStoredHidden,
} from "#/lib/table-state";

/**
 * A column definition for an admin table.
 *
 * `header` is narrowed to a plain string and `id` is required, because both
 * are load-bearing beyond rendering: the header text is reused verbatim as
 * every body cell's `data-label`, which is what `src/styles.css` turns into
 * the field name on mobile cards, and the id is what the URL carries.
 *
 * `defaultHidden` is the single source of truth for a column's initial
 * visibility. There is deliberately no separate list of defaults to keep in
 * sync with it.
 */
export type AdminColumn<T> = ColumnDef<T, unknown> & {
  defaultHidden?: boolean;
  header: string;
  id: string;
};

export interface AdminDataTableProps<T> {
  caption: string;
  columns: AdminColumn<T>[];
  data: T[];
  defaultSort: SortState;
  emptyMessage: string;
  getRowId: (row: T) => string;
  hidden: string[];
  onHiddenChange: (cols: string | undefined) => void;
  onSortChange: (sort: SortState) => void;
  sort: SortState;
  storageKey: string;
  toolbar?: ReactNode;
}

function ariaSort(
  direction: false | "asc" | "desc"
): "ascending" | "descending" | "none" {
  if (direction === "asc") {
    return "ascending";
  }
  if (direction === "desc") {
    return "descending";
  }
  return "none";
}

function SortIcon({ direction }: { direction: false | "asc" | "desc" }) {
  if (direction === "asc") {
    return <ChevronUp aria-hidden className="size-3.5" />;
  }
  if (direction === "desc") {
    return <ChevronDown aria-hidden className="size-3.5" />;
  }
  return <ChevronsUpDown aria-hidden className="size-3.5 opacity-40" />;
}

/**
 * The shared staff table. Sorting and column visibility are controlled by the
 * caller, which keeps the URL as the single source of truth and lets this
 * render in tests without a router.
 */
export function AdminDataTable<T>({
  caption,
  columns,
  data,
  defaultSort,
  emptyMessage,
  getRowId,
  hidden,
  onHiddenChange,
  onSortChange,
  sort,
  storageKey,
  toolbar,
}: AdminDataTableProps<T>) {
  // The header string doubles as each cell's `data-label`, so read it from our
  // own column list rather than from TanStack's widened `columnDef.header`,
  // whose type also admits render functions.
  const labels = useMemo(
    () => new Map(columns.map((column) => [column.id, column.header])),
    [columns]
  );
  const defaultHidden = useMemo(
    () =>
      columns.filter((column) => column.defaultHidden).map((column) => column.id),
    [columns]
  );

  const sorting: SortingState = useMemo(
    () => [{ desc: sort.desc, id: sort.id }],
    [sort.desc, sort.id]
  );
  const columnVisibility: VisibilityState = useMemo(
    () => Object.fromEntries(hidden.map((id) => [id, false])),
    [hidden]
  );

  const table = useReactTable({
    columns,
    data,
    getCoreRowModel: getCoreRowModel(),
    getRowId,
    getSortedRowModel: getSortedRowModel(),
    onColumnVisibilityChange: (updater) => {
      const next =
        typeof updater === "function" ? updater(columnVisibility) : updater;
      const nextHidden = Object.entries(next)
        .filter(([, visible]) => !visible)
        .map(([id]) => id);
      writeStoredHidden(storageKey, nextHidden);
      onHiddenChange(serializeHidden(nextHidden, defaultHidden));
    },
    onSortingChange: (updater) => {
      const next = typeof updater === "function" ? updater(sorting) : updater;
      const first: ColumnSort = next[0] ?? {
        desc: defaultSort.desc,
        id: defaultSort.id,
      };
      onSortChange({ desc: first.desc, id: first.id });
    },
    state: { columnVisibility, sorting },
  });

  const rows = table.getRowModel().rows;
  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());

  const resetColumns = () => {
    writeStoredHidden(storageKey, defaultHidden);
    onHiddenChange(undefined);
  };

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">{toolbar}</div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Columns3 aria-hidden className="size-4" />
              Columns
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {hideable.map((column) => (
              <DropdownMenuCheckboxItem
                checked={column.getIsVisible()}
                key={column.id}
                onCheckedChange={(value) => column.toggleVisibility(value)}
                onSelect={(event) => event.preventDefault()}
              >
                {labels.get(column.id) ?? column.id}
              </DropdownMenuCheckboxItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={resetColumns}>
              Reset columns
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <p aria-live="polite" className="sr-only">
        {rows.length === 1 ? "1 row" : `${rows.length} rows`}
      </p>

      {rows.length === 0 ? (
        <EmptyState>{emptyMessage}</EmptyState>
      ) : (
        <Table className="admin-table mt-4">
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                {group.headers.map((header) => {
                  const direction = header.column.getIsSorted();
                  const label = labels.get(header.column.id) ?? "";
                  return (
                    <TableHead
                      aria-sort={ariaSort(direction)}
                      className="bg-secondary md:sticky md:top-0 md:z-10"
                      key={header.id}
                      scope="col"
                    >
                      {header.column.getCanSort() ? (
                        <button
                          className="inline-flex items-center gap-1 hover:underline"
                          onClick={header.column.getToggleSortingHandler()}
                          type="button"
                        >
                          {label}
                          <SortIcon direction={direction} />
                        </button>
                      ) : (
                        label
                      )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell
                    data-label={labels.get(cell.column.id) ?? ""}
                    key={cell.id}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `ulimit -n 8192; CI=true npx vitest run src/test/admin-data-table.test.tsx`
Expected: PASS, 12 tests.

If "sorts text case-insensitively" fails, TanStack auto-detected the
`alphanumeric` sorting function for the Name column instead of `text`. Set
`sortingFn: "text"` explicitly on string columns in `AdminColumn` consumers, or
better, default it in `AdminDataTable` for any column without its own
`sortingFn`.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run check && npm run typecheck
git add src/components/ui/table.tsx src/components/admin-data-table.tsx src/test/admin-data-table.test.tsx
git commit -m "feat(admin): add the shared sortable data table"
```

---

## Task 3: Inventory server listing

**Files:**
- Modify: `src/server/_internal/inventory.ts`
- Modify: `src/server/inventory.ts`
- Test: `src/server/__tests__/admin-inventory.integration.test.ts`

**Interfaces:**
- Consumes: nothing from Tasks 1 and 2.
- Produces: `listAdminInventoryAs(viewer, { category, q, status })` returning `{ rows }`, where each row is `InventoryItemStaff & { createdAt: Date; currentHolderEmail: string | null; currentHolderName: string | null; dueAt: Date | null; pickupBy: Date | null; updatedAt: Date }`; and the `listAdminInventory` server function taking `{ category: string | null; q: string; status: ItemStatus | null }`.

- [ ] **Step 1: Write the failing integration tests**

Create `src/server/__tests__/admin-inventory.integration.test.ts`. Model the admin/user fixtures on `src/server/__tests__/admin-projects-filter.integration.test.ts`, which already has a `makeAdmin` helper worth copying:

```ts
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { inventoryItems, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { listAdminInventoryAs } from "#/server/_internal/inventory";

async function makeAdmin(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role: "admin" })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

async function makeHolder(email: string, name: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name },
  });
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return u.id;
}

const EMPTY = { category: null, q: "", status: null } as const;

describe("listAdminInventoryAs", () => {
  it("returns every matching row rather than one page", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db.insert(inventoryItems).values(
      Array.from({ length: 25 }, (_, i) => ({ name: `Item ${i}` }))
    );
    const { rows } = await listAdminInventoryAs(admin, EMPTY);
    expect(rows).toHaveLength(25);
  });

  it("excludes retired items", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db
      .insert(inventoryItems)
      .values([{ name: "Live" }, { name: "Gone", status: "retired" }]);
    const { rows } = await listAdminInventoryAs(admin, EMPTY);
    expect(rows.map((r) => r.name)).toEqual(["Live"]);
  });

  it("finds an item by its serial", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db
      .insert(inventoryItems)
      .values([
        { name: "Oscilloscope", serial: "SN-99812" },
        { name: "Multimeter", serial: "SN-11111" },
      ]);
    const { rows } = await listAdminInventoryAs(admin, {
      ...EMPTY,
      q: "99812",
    });
    expect(rows.map((r) => r.name)).toEqual(["Oscilloscope"]);
  });

  it("finds an item by its asset label", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db
      .insert(inventoryItems)
      .values([{ label: "CS-0042", name: "Soldering iron" }]);
    const { rows } = await listAdminInventoryAs(admin, {
      ...EMPTY,
      q: "CS-0042",
    });
    expect(rows.map((r) => r.name)).toEqual(["Soldering iron"]);
  });

  it("finds an item by its location", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db
      .insert(inventoryItems)
      .values([{ location: "Kelley 3068", name: "Robot arm" }]);
    const { rows } = await listAdminInventoryAs(admin, {
      ...EMPTY,
      q: "Kelley",
    });
    expect(rows.map((r) => r.name)).toEqual(["Robot arm"]);
  });

  it("finds an item by who is holding it", async () => {
    const admin = await makeAdmin("admin@example.edu");
    const holderId = await makeHolder("dana@example.edu", "Dana Reyes");
    await db
      .insert(inventoryItems)
      .values([
        { currentHolderId: holderId, name: "Tripod" },
        { name: "Backdrop" },
      ]);
    const { rows } = await listAdminInventoryAs(admin, {
      ...EMPTY,
      q: "dana@example.edu",
    });
    expect(rows.map((r) => r.name)).toEqual(["Tripod"]);
  });

  it("carries the timestamps the table sorts by", async () => {
    const admin = await makeAdmin("admin@example.edu");
    await db.insert(inventoryItems).values([{ name: "Camera" }]);
    const { rows } = await listAdminInventoryAs(admin, EMPTY);
    expect(rows[0].createdAt).toBeInstanceOf(Date);
    expect(rows[0].updatedAt).toBeInstanceOf(Date);
  });

  it("refuses a non-staff viewer", async () => {
    const holderId = await makeHolder("student@example.edu", "Student");
    await expect(
      listAdminInventoryAs({ id: holderId, role: "user" }, EMPTY)
    ).rejects.toThrow("Forbidden");
  });
});

describe("public inventory search stays narrow", () => {
  it("does not match a staff-only serial", async () => {
    const { listInventoryAs } = await import("#/server/_internal/inventory");
    await db
      .insert(inventoryItems)
      .values([{ name: "Oscilloscope", serial: "SN-99812" }]);
    const { rows } = await listInventoryAs(null, {
      category: null,
      page: 1,
      pageSize: 24,
      q: "99812",
      status: null,
    });
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ulimit -n 8192; CI=true npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-inventory.integration.test.ts`
Expected: FAIL, `listAdminInventoryAs` is not exported.

- [ ] **Step 3: Add the timestamps to staff rows**

In `src/server/_internal/inventory.ts`, extend the type at line 55 and the mapper at line 84:

```ts
export type InventoryItemStaff = InventoryItemPublic & {
  createdAt: Date;
  currentHolderId: string | null;
  currentHolderLabel: string | null;
  currentRequestItemId: string | null;
  label: string | null;
  location: string | null;
  notes: string | null;
  serial: string | null;
  updatedAt: Date;
};
```

and in `fullForStaff`, add `createdAt: row.createdAt,` and `updatedAt: row.updatedAt,` to the returned object. This widens the staff detail payload too, which is harmless: the fields are already staff-visible everywhere else.

- [ ] **Step 4: Extract the shared scope builder**

Still in `src/server/_internal/inventory.ts`, pull the non-search conditions out of `listInventoryAs` so both listings agree on what "retired is excluded" means:

```ts
/**
 * The conditions every inventory listing shares. Search is deliberately not
 * included: the public predicate matches name and the tsvector only, while
 * the staff predicate also reaches serial, label, location and holder, and
 * those must never become publicly searchable.
 */
function buildInventoryScope(data: {
  category: string | null;
  status: ListInventoryInput["status"];
}): SQL[] {
  const conditions: SQL[] = [ne(inventoryItems.status, "retired")];
  if (data.status) {
    conditions.push(eq(inventoryItems.status, data.status));
  }
  if (data.category) {
    conditions.push(eq(inventoryItems.category, data.category));
  }
  return conditions;
}
```

Rewrite the opening of `listInventoryAs` to call it, leaving its existing `q` handling, ordering, pagination, and count query exactly as they are.

- [ ] **Step 5: Add the admin listing**

Append to `src/server/_internal/inventory.ts`:

```ts
export interface ListAdminInventoryInput {
  category: string | null;
  q: string;
  status: ListInventoryInput["status"];
}

/**
 * The staff inventory listing: every matching row, unpaginated, because the
 * table sorts client-side and a page of 20 would make "sort by name" a lie.
 *
 * The search predicate is wider than the public one on purpose, reaching the
 * fields staff actually hunt by. It stays in this function rather than in the
 * shared scope so those staff-only fields cannot leak into public search.
 */
export async function listAdminInventoryAs(
  viewer: Viewer,
  data: ListAdminInventoryInput
) {
  assertStaff(viewer);
  const conditions = buildInventoryScope(data);
  const trimmed = data.q.trim();
  if (trimmed) {
    const like = `%${trimmed}%`;
    const match = or(
      sql`${inventoryItems.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`,
      ilike(inventoryItems.name, like),
      ilike(inventoryItems.serial, like),
      ilike(inventoryItems.label, like),
      ilike(inventoryItems.location, like),
      ilike(user.name, like),
      ilike(user.email, like)
    );
    if (match) {
      conditions.push(match);
    }
  }

  const rows = await db
    .select({
      dueAt: inventoryRequestItems.dueAt,
      holderEmail: user.email,
      holderName: user.name,
      item: inventoryItems,
      pickupBy: inventoryRequestItems.pickupBy,
    })
    .from(inventoryItems)
    .leftJoin(
      inventoryRequestItems,
      eq(inventoryItems.currentRequestItemId, inventoryRequestItems.id)
    )
    .leftJoin(user, eq(inventoryItems.currentHolderId, user.id))
    .where(and(...conditions))
    .orderBy(desc(inventoryItems.updatedAt));

  return {
    rows: rows.map((r) => ({
      ...fullForStaff(r.item),
      currentHolderEmail: r.holderEmail,
      currentHolderName: r.holderName,
      dueAt: r.dueAt,
      pickupBy: r.pickupBy,
    })),
  };
}

export async function listAdminInventoryForCurrentUser(
  data: ListAdminInventoryInput
) {
  const session = await readSession();
  return listAdminInventoryAs(session?.user ?? null, data);
}
```

`assertStaff` already exists in this file at line 278 and throws `Error("Forbidden")`, which is what the test expects. Import `SQL` as a type from `drizzle-orm` if it is not already imported.

- [ ] **Step 6: Add the server function**

In `src/server/inventory.ts`, beside the existing `listInventory`:

```ts
const listAdminInventorySchema = z.object({
  category: z.string().nullable().default(null),
  q: z.string().default(""),
  status: itemStatusEnum.nullable().default(null),
});

export const listAdminInventory = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listAdminInventorySchema.parse(d))
  .handler(async ({ data }) => {
    const { listAdminInventoryForCurrentUser } = await import(
      "./_internal/inventory"
    );
    return listAdminInventoryForCurrentUser(data);
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `ulimit -n 8192; CI=true npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-inventory.integration.test.ts`
Expected: PASS, 9 tests.

Then confirm nothing else regressed: `ulimit -n 8192; CI=true npm run test:integration`

- [ ] **Step 8: Lint, typecheck, commit**

```bash
npm run check && npm run typecheck
git add src/server/_internal/inventory.ts src/server/inventory.ts src/server/__tests__/admin-inventory.integration.test.ts
git commit -m "feat(inventory): add an unpaginated staff listing with a wider search"
```

---

## Task 4: The inventory route

**Files:**
- Modify: `src/routes/_authed/admin/inventory/index.tsx` (full rewrite of the component and its search schema)

**Interfaces:**
- Consumes: `AdminDataTable`, `AdminColumn` (Task 2); `parseSort`, `serializeSort`, `parseHidden`, `serializeHidden`, `useSeedColumnsFromStorage`, `SortState` (Task 1); `listAdminInventory` (Task 3).
- Produces: nothing consumed by later tasks. Tasks 6 and 7 copy this route's shape, so get it right here.

- [ ] **Step 1: Rewrite the search schema and loader**

Replace the schema and route definition. The critical detail is `loaderDeps`: it must list only the filter fields. Including `sort`, `dir`, or `cols` would refetch from Postgres on every sort click and every column toggle.

```ts
const searchSchema = z.object({
  category: z.string().nullable().default(null),
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  q: z.string().default(""),
  sort: z.string().optional(),
  status: z.enum(STATUSES).nullable().default(null),
});

export const Route = createFileRoute("/_authed/admin/inventory/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Inventory") }] }),
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  // Only the filter fields: sort and column visibility are client state and
  // must not re-run the loader.
  loaderDeps: ({ search }) => ({
    category: search.category,
    q: search.q,
    status: search.status,
  }),
  loader: async ({ deps }) => {
    const [items, categories] = await Promise.all([
      listAdminInventory({ data: deps }),
      listInventoryCategories(),
    ]);
    return { categories: categories.categories, rows: items.rows };
  },
  component: AdminInventory,
});
```

- [ ] **Step 2: Define the columns**

```tsx
type Row = Awaited<ReturnType<typeof listAdminInventory>>["rows"][number];

const STATUS_ORDER: Record<string, number> = {
  available: 0,
  requested: 1,
  reserved: 2,
  checked_out: 3,
  maintenance: 4,
};

const DEFAULT_SORT: SortState = { desc: true, id: "updatedAt" };

const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.name,
    cell: ({ row }) => {
      const img = getPublicUrl(row.original.imageUrl);
      return (
        <div className="flex items-center gap-2">
          {img ? (
            <img alt="" className="h-8 w-8 rounded object-cover" src={img} />
          ) : (
            <div className="h-8 w-8 rounded bg-secondary" />
          )}
          <Link
            className="hover:underline"
            params={{ itemId: row.original.id }}
            to="/inventory/$itemId"
          >
            {row.original.name}
          </Link>
        </div>
      );
    },
    enableHiding: false,
    header: "Name",
    id: "name",
  },
  {
    // Alphabetical status order means nothing to a reader; this is the order
    // an item actually moves through.
    accessorFn: (row) => STATUS_ORDER[row.status] ?? 99,
    cell: ({ row }) => (
      <InventoryStatusBadge showRetired status={row.original.status as Status} />
    ),
    header: "Status",
    id: "status",
  },
  {
    accessorFn: (row) =>
      row.currentHolderName ?? row.currentHolderLabel ?? undefined,
    cell: ({ row }) =>
      row.original.currentHolderName ??
      row.original.currentHolderLabel ??
      (row.original.currentHolderId ? "(user)" : "-"),
    header: "Holder",
    id: "holder",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.location ?? undefined,
    cell: ({ row }) => row.original.location ?? "-",
    header: "Location",
    id: "location",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.category ?? undefined,
    cell: ({ row }) => row.original.category ?? "-",
    header: "Category",
    id: "category",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.label ?? undefined,
    cell: ({ row }) => row.original.label ?? "-",
    defaultHidden: true,
    header: "Label",
    id: "label",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.serial ?? undefined,
    cell: ({ row }) => row.original.serial ?? "-",
    defaultHidden: true,
    header: "Serial",
    id: "serial",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.dueAt ?? undefined,
    cell: ({ row }) =>
      row.original.dueAt ? (
        <LocalTime dateOnly value={row.original.dueAt} />
      ) : (
        "-"
      ),
    defaultHidden: true,
    header: "Due",
    id: "dueAt",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.updatedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.updatedAt} />,
    defaultHidden: true,
    header: "Updated",
    id: "updatedAt",
  },
  {
    accessorFn: (row) => row.createdAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
    defaultHidden: true,
    header: "Created",
    id: "createdAt",
  },
  {
    cell: ({ row }) => (
      <Link
        className="hover:underline"
        params={{ itemId: row.original.id }}
        to="/inventory/$itemId/edit"
      >
        Edit
      </Link>
    ),
    enableHiding: false,
    enableSorting: false,
    header: "Actions",
    id: "actions",
  },
];
```

`COLUMNS` and `DEFAULT_SORT` must be module-level constants, not values built
inside the component. `useAdminTableState` derives its sortable, hideable, and
default-hidden id lists from `COLUMNS` and memoizes on its identity, so a fresh
array every render would defeat the memoization and re-run the seeding effect.

- [ ] **Step 3: Wire the component**

```tsx
function AdminInventory() {
  const navigate = useNavigate({ from: "/admin/inventory/" });
  const { categories, rows } = Route.useLoaderData();
  // The whole search object goes to the hook, which reads cols/dir/sort.
  const search = Route.useSearch();
  const { category, q, status } = search;
  const [qDraft, setQDraft] = useState(q);

  useEffect(() => setQDraft(q), [q]);

  useEffect(() => {
    const t = setTimeout(() => {
      if (qDraft !== q) {
        void navigate({ search: (prev) => ({ ...prev, q: qDraft }) });
      }
    }, 300);
    return () => clearTimeout(t);
  }, [qDraft, q, navigate]);

  const setSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({ search: (prev) => ({ ...prev, ...patch }) }),
    [navigate]
  );
  const replaceSearch = useCallback(
    (patch: AdminTableSearch) =>
      void navigate({ replace: true, search: (prev) => ({ ...prev, ...patch }) }),
    [navigate]
  );

  const { hidden, onHiddenChange, onSortChange, sort } = useAdminTableState({
    columns: COLUMNS,
    defaultSort: DEFAULT_SORT,
    replaceSearch,
    search,
    setSearch,
    storageKey: "inventory",
  });

  return (
    <div className="px-4 py-6 md:px-8">
      {/* breadcrumb and heading unchanged from the current file */}
      <AdminDataTable
        caption="Inventory items"
        columns={COLUMNS}
        data={rows}
        defaultSort={DEFAULT_SORT}
        emptyMessage="No items in this view."
        getRowId={(row) => row.id}
        hidden={hidden}
        onHiddenChange={onHiddenChange}
        onSortChange={onSortChange}
        sort={sort}
        storageKey="inventory"
        toolbar={
          <>
            {/* the existing Search input and Status select, unchanged */}
            <div>
              <Label htmlFor="inv-category">Category</Label>
              <Select
                onValueChange={(v) =>
                  void navigate({
                    search: (prev) => ({
                      ...prev,
                      category: v === "_all_" ? null : v,
                    }),
                  })
                }
                value={category ?? "_all_"}
              >
                <SelectTrigger className="mt-1 w-40" id="inv-category">
                  <SelectValue placeholder="All categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all_">All categories</SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        }
      />
    </div>
  );
}
```

Delete from the file: the `page`/`pageSize` search fields, the `StaffRow` interface (the loader's return type replaces it), the `AdminTable` import and usage, the `totalPages` computation, and the whole Previous/Next block at the end. Change the outer container from `mx-auto max-w-4xl px-4 py-6 md:p-8` to `px-4 py-6 md:px-8`.

- [ ] **Step 4: Verify in the browser**

```bash
npm run db:seed:dev && npm run db:seed:admin
npm run dev
```

Visit `/admin/inventory` and confirm: clicking a header sorts and puts `?sort=&dir=` in the URL; the Columns menu toggles a column and puts `?cols=` in the URL; a reload keeps the layout; the URL has no `cols` param when the defaults are showing; narrowing the window below 768px produces cards with field labels; the sticky header stays put while scrolling.

- [ ] **Step 5: Run the full unit suite**

Run: `ulimit -n 8192; CI=true npm test`
Expected: PASS.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run check && npm run typecheck
git add src/routes/_authed/admin/inventory/index.tsx
git commit -m "feat(admin): rebuild the inventory list as a sortable data table"
```

---

## Task 5: Projects server listing

**Files:**
- Modify: `src/server/_internal/project-summary.ts`
- Modify: `src/server/_internal/projects-queries.ts`
- Test: `src/server/__tests__/admin-projects-filter.integration.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `adminProjectSummarySelect`, and a widened `listAdminProjectsAs` whose rows additionally carry `contactEmail`, `createdAt`, `deletedAt`, `programId`, `proposerEmail`, `proposerId`, `proposerName`, `publishedAt`, and `teamsSupported`.

- [ ] **Step 1: Write the failing integration tests**

Append to `src/server/__tests__/admin-projects-filter.integration.test.ts`. The file already has `makeAdmin`, `makeProgram`, and `baseProject` helpers; reuse them.

```ts
describe("admin project search reaches people, not just text", () => {
  it("finds a project by its proposer's email", async () => {
    const admin = await makeAdmin("staff@example.edu");
    const proposer = await makeAdmin("rivera@example.edu");
    await createProjectAs(proposer, baseProject("Trail Mapper", null));
    const { rows } = await listAdminProjectsAs(admin, {
      includeSoftDeleted: false,
      program: null,
      proposer: null,
      q: "rivera@example.edu",
      status: "all",
    });
    expect(rows.map((r) => r.title)).toEqual(["Trail Mapper"]);
  });

  it("finds a project by its contact name", async () => {
    const admin = await makeAdmin("staff@example.edu");
    await createProjectAs(admin, {
      ...baseProject("Weather Station", null),
      contactName: "Priya Raman",
    });
    const { rows } = await listAdminProjectsAs(admin, {
      includeSoftDeleted: false,
      program: null,
      proposer: null,
      q: "Priya",
      status: "all",
    });
    expect(rows.map((r) => r.title)).toEqual(["Weather Station"]);
  });

  it("still lists a project whose proposer account was deleted", async () => {
    const admin = await makeAdmin("staff@example.edu");
    const proposer = await makeAdmin("leaving@example.edu");
    await createProjectAs(proposer, baseProject("Orphan Project", null));
    await db.delete(user).where(eq(user.id, proposer.id));
    const { rows } = await listAdminProjectsAs(admin, {
      includeSoftDeleted: false,
      program: null,
      proposer: null,
      q: "",
      status: "all",
    });
    expect(rows.map((r) => r.title)).toContain("Orphan Project");
  });

  it("carries the proposer and contact fields the table shows", async () => {
    const admin = await makeAdmin("staff@example.edu");
    await createProjectAs(admin, {
      ...baseProject("Rich Row", null),
      contactEmail: "contact@example.edu",
    });
    const { rows } = await listAdminProjectsAs(admin, {
      includeSoftDeleted: false,
      program: null,
      proposer: null,
      q: "",
      status: "all",
    });
    expect(rows[0].proposerEmail).toBe("staff@example.edu");
    expect(rows[0].contactEmail).toBe("contact@example.edu");
    expect(rows[0].teamsSupported).toBe(1);
  });
});
```

If `baseProject` does not already include `contactEmail` or `contactName` keys, add them as `null` there so the spreads above type-check.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `ulimit -n 8192; CI=true npx vitest run --config vitest.integration.config.ts src/server/__tests__/admin-projects-filter.integration.test.ts`
Expected: FAIL on the new cases.

- [ ] **Step 3: Add the admin projection**

Append to `src/server/_internal/project-summary.ts`:

```ts
/**
 * The staff listing's projection. It deliberately does not widen
 * `projectSummarySelect`, which the public listing and "my projects" share:
 * proposer identity and contact email are staff information.
 *
 * Join `programs` and `user` (on `projects.proposerId`) before using it.
 */
export const adminProjectSummarySelect = {
  ...projectSummarySelect,
  contactEmail: projects.contactEmail,
  createdAt: projects.createdAt,
  deletedAt: projects.deletedAt,
  programId: projects.programId,
  proposerEmail: user.email,
  proposerId: projects.proposerId,
  proposerName: user.name,
  publishedAt: projects.publishedAt,
  teamsSupported: projects.teamsSupported,
};
```

Add `user` to the `#/db/schema` import at the top of that file.

- [ ] **Step 4: Widen the query**

In `src/server/_internal/projects-queries.ts`, inside `listAdminProjectsAs`, change the rows query (currently at lines 152 to 157):

```ts
db
  .select(adminProjectSummarySelect)
  .from(projects)
  .leftJoin(programs, eq(projects.programId, programs.id))
  // Left, not inner: `proposerId` is `onDelete: "set null"`, so an inner join
  // would silently drop projects whose proposer account was removed.
  .leftJoin(user, eq(projects.proposerId, user.id))
  .where(listConditions.length ? and(...listConditions) : undefined)
  .orderBy(desc(projects.updatedAt)),
```

and widen the search predicate (currently lines 142 to 145):

```ts
const like = `%${trimmed}%`;
const match = or(
  sql`${projects.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`,
  ilike(projects.title, like),
  ilike(projects.contactName, like),
  ilike(projects.contactEmail, like),
  ilike(user.name, like),
  ilike(user.email, like)
);
```

Leave the `proposers` sub-query and the `scope` array exactly as they are. The comment at line 117 explaining why the proposer dropdown is built from a narrower scope still applies.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `ulimit -n 8192; CI=true npm run test:integration`
Expected: PASS, including every pre-existing case in the file.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run check && npm run typecheck
git add src/server/_internal/project-summary.ts src/server/_internal/projects-queries.ts src/server/__tests__/admin-projects-filter.integration.test.ts
git commit -m "feat(projects): give the staff listing proposer, contact and lifecycle fields"
```

---

## Task 6: The projects route

**Files:**
- Modify: `src/routes/_authed/admin/projects/index.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, and 5. Follows the exact route shape established in Task 4; read that route's final source before starting.

- [ ] **Step 1: Extend the search schema**

Add `cols: z.string().optional()`, `dir: z.enum(["asc", "desc"]).optional()`, and `sort: z.string().optional()` to the existing schema. Leave `loaderDeps` (lines 65 to 71) exactly as it is: it already lists only filter fields, which is what Task 4 had to fix on inventory.

- [ ] **Step 2: Define the columns**

```tsx
type Row = Awaited<ReturnType<typeof listAdminProjects>>["rows"][number];

const STATUS_ORDER: Record<string, number> = {
  draft: 0,
  submitted: 1,
  changes_requested: 2,
  approved: 3,
  published: 4,
  archived: 5,
};

const DEFAULT_SORT: SortState = { desc: true, id: "updatedAt" };

const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.title,
    cell: ({ row }) => (
      <div className="flex items-center gap-2">
        <ImageOrFallback
          className="aspect-[3/2] w-16 shrink-0 rounded object-cover"
          src={projectImageSrc(row.original.imageUrl)}
        />
        <Link
          className="hover:underline"
          params={{ projectId: row.original.id }}
          to="/projects/$projectId"
        >
          {row.original.title}
        </Link>
        {row.original.deletedAt && (
          <span className="rounded bg-destructive/10 px-1.5 py-0.5 text-destructive text-xs">
            Deleted
          </span>
        )}
      </div>
    ),
    enableHiding: false,
    header: "Title",
    id: "title",
  },
  {
    accessorFn: (row) => STATUS_ORDER[row.status] ?? 99,
    cell: ({ row }) => <StatusBadge status={row.original.status} />,
    header: "Status",
    id: "status",
  },
  {
    accessorFn: (row) => row.proposerName ?? row.proposerEmail ?? undefined,
    cell: ({ row }) => {
      if (!(row.original.proposerName || row.original.proposerEmail)) {
        return "-";
      }
      return (
        <div className="leading-tight">
          <span className="block">{row.original.proposerName ?? "(no name)"}</span>
          <span className="block text-muted-foreground text-xs">
            {row.original.proposerEmail}
          </span>
        </div>
      );
    },
    header: "Proposer",
    id: "proposer",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => programLabel(row) ?? undefined,
    cell: ({ row }) => programLabel(row.original) ?? "-",
    header: "Program",
    id: "program",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.updatedAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.updatedAt} />,
    header: "Updated",
    id: "updatedAt",
  },
  {
    accessorFn: (row) => row.contactName ?? row.contactEmail ?? undefined,
    cell: ({ row }) =>
      row.original.contactName ?? row.original.contactEmail ?? "-",
    defaultHidden: true,
    header: "Contact",
    id: "contact",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.teamsSupported,
    cell: ({ row }) => row.original.teamsSupported,
    defaultHidden: true,
    header: "Teams",
    id: "teams",
  },
  {
    accessorFn: (row) => row.createdAt,
    cell: ({ row }) => <LocalTime dateOnly value={row.original.createdAt} />,
    defaultHidden: true,
    header: "Created",
    id: "createdAt",
  },
  {
    accessorFn: (row) => row.publishedAt ?? undefined,
    cell: ({ row }) =>
      row.original.publishedAt ? (
        <LocalTime dateOnly value={row.original.publishedAt} />
      ) : (
        "-"
      ),
    defaultHidden: true,
    header: "Published",
    id: "publishedAt",
    sortUndefined: "last",
  },
  {
    cell: ({ row }) => (
      <Link
        className="hover:underline"
        params={{ projectId: row.original.id }}
        to="/projects/$projectId/edit"
      >
        Edit
      </Link>
    ),
    enableHiding: false,
    enableSorting: false,
    header: "Actions",
    id: "actions",
  },
];
```

`programLabel` is exported from `#/components/project-card` and takes an object with `programCourseId` and `programCourseName`. If its signature does not accept the admin row type directly, pass `{ programCourseId: row.programCourseId, programCourseName: row.programCourseName }`. Confirm the edit route path with `ls src/routes/_authed/projects/\$projectId/` before writing the Actions cell.

- [ ] **Step 3: Wire the component**

Open `src/routes/_authed/admin/inventory/index.tsx` as Task 4 committed it and follow its shape: the two `useCallback` wrappers (`setSearch`, `replaceSearch`) around `navigate`, then one `useAdminTableState` call. That is four short blocks, not a copied wiring section, because the hook from Task 1 holds the logic. Pass `storageKey: "projects"` and this file's own module-level `COLUMNS` and `DEFAULT_SORT`.

Move the five existing filter controls (search input, status select, program select, proposer select, soft-deleted switch) into the `toolbar` prop unchanged. Delete the `ProjectRow` import, the `EmptyState` import and its conditional (the shared table renders the empty state now), and change the container from `mx-auto max-w-4xl px-4 py-6 md:p-8` to `px-4 py-6 md:px-8`.

`emptyMessage` is `"No projects in this view."`, matching the current copy. `caption` is `"Projects"`.

- [ ] **Step 4: Verify in the browser**

Visit `/admin/projects` and confirm all five filters still work, sorting by Proposer puts projects with no proposer last in both directions, a soft-deleted project shows its badge when the switch is on, and `project-list-item.tsx` still renders cards on the public `/projects` page.

- [ ] **Step 5: Run the unit suite**

Run: `ulimit -n 8192; CI=true npm test`
Expected: PASS, including `src/test/project-row.test.tsx`, which must still pass because `ProjectRow` is untouched.

- [ ] **Step 6: Lint, typecheck, commit**

```bash
npm run check && npm run typecheck
git add src/routes/_authed/admin/projects/index.tsx
git commit -m "feat(admin): rebuild the projects list as a sortable data table"
```

---

## Task 7: Mentors, and removing the old table

**Files:**
- Modify: `src/server/_internal/users.ts`
- Modify: `src/server/users.ts`
- Modify: `src/routes/_authed/admin/mentors/index.tsx`
- Modify: `src/test/admin-data-table.test.tsx` (one added test)
- ~~Delete: `src/components/admin-table.tsx`~~ (see the correction in File Structure: it still has three consumers and stays)

**Interfaces:**
- Consumes: Tasks 1 and 2, and the route shape from Task 4.
- Produces: `listMentorsAs(viewer, { q })`.

- [ ] **Step 1: Write the failing inline-edit test**

This is the regression that protects the mentors page. Add to `src/test/admin-data-table.test.tsx`:

```tsx
it("keeps a cell's unsaved input value across a re-sort", () => {
  function EditableCell() {
    const [value, setValue] = useState("");
    return (
      <input
        aria-label="Teams"
        onChange={(e) => setValue(e.target.value)}
        value={value}
      />
    );
  }

  const columns: AdminColumn<Row>[] = [
    ...COLUMNS,
    {
      cell: () => <EditableCell />,
      enableHiding: false,
      enableSorting: false,
      header: "Teams",
      id: "teams",
    },
  ];

  const props = {
    caption: "Test items",
    columns,
    data: DATA,
    defaultSort: DEFAULT_SORT,
    emptyMessage: "Nothing here.",
    getRowId: (row: Row) => row.id,
    hidden: [],
    onHiddenChange: vi.fn(),
    onSortChange: vi.fn(),
    storageKey: "test",
  };

  const { rerender } = render(
    <AdminDataTable {...props} sort={{ desc: false, id: "name" }} />
  );
  const input = screen.getAllByLabelText("Teams")[0] as HTMLInputElement;
  fireEvent.change(input, { target: { value: "4" } });

  rerender(<AdminDataTable {...props} sort={{ desc: true, id: "name" }} />);

  // "Alpha" sorted first ascending and last descending. Its input must have
  // moved with it rather than being remounted at position 0.
  const inputs = screen.getAllByLabelText("Teams") as HTMLInputElement[];
  expect(inputs.at(-1)?.value).toBe("4");
});
```

Add `fireEvent` to the `@testing-library/react` import and `useState` to a `react` import at the top of the file.

- [ ] **Step 2: Run it to verify it passes**

Run: `ulimit -n 8192; CI=true npx vitest run src/test/admin-data-table.test.tsx`
Expected: PASS, because `AdminDataTable` already requires `getRowId` and keys rows by `row.id`.

If it FAILS, the component is keying rows positionally. Fix `AdminDataTable`, not the test: this is the exact bug the required `getRowId` prop exists to prevent.

- [ ] **Step 3: Add the mentors search parameter**

In `src/server/_internal/users.ts`, change `listMentorsAs` (line 223):

```ts
export async function listMentorsAs(
  viewer: AuthUser,
  data: { q: string } = { q: "" }
) {
  assertStaff(viewer);
  const conditions = [eq(user.wantsToMentor, true)];
  const trimmed = data.q.trim();
  if (trimmed) {
    // The `user` table carries no tsvector, so this is substring matching.
    // Adequate for a list of a few dozen people.
    const like = `%${trimmed}%`;
    const match = or(
      ilike(user.name, like),
      ilike(user.email, like),
      ilike(user.affiliation, like)
    );
    if (match) {
      conditions.push(match);
    }
  }
  const rows = await db
    .select({
      affiliation: user.affiliation,
      email: user.email,
      id: user.id,
      mentorTeamCount: user.mentorTeamCount,
      name: user.name,
    })
    .from(user)
    .where(and(...conditions))
    .orderBy(user.name);
  return { rows };
}
```

Import `and`, `ilike`, and `or` from `drizzle-orm` if they are not already imported. Update `listMentorsForCurrentUser` to accept and forward the parameter.

In `src/server/users.ts`, give `listMentors` an input validator:

```ts
const listMentorsSchema = z.object({ q: z.string().default("") });

export const listMentors = createServerFn({ method: "GET" })
  .inputValidator((d: unknown) => listMentorsSchema.parse(d))
  .handler(async ({ data }) => {
    const { listMentorsForCurrentUser } = await import("./_internal/users");
    return listMentorsForCurrentUser(data);
  });
```

Every existing caller must now pass `{ data: { q: "" } }`. Find them with `grep -rn "listMentors(" src/`.

- [ ] **Step 4: Rebuild the mentors route**

Add a `validateSearch` schema (the route has none today):

```ts
const searchSchema = z.object({
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  q: z.string().default(""),
  sort: z.string().optional(),
});
```

with `loaderDeps: ({ search }) => ({ q: search.q })` and `loader: async ({ deps }) => await listMentors({ data: deps })`.

Keep `MentorRow`'s save/remove logic, but convert it from a component returning `<tr>` into the cells of two columns. The Teams and Actions cells both need the same `count`/`saving`/`error` state, so keep one component per row and render it from the Teams cell, with the Actions cell reading the same state. The simplest structure that preserves behavior: keep a single `MentorControls` component holding the state and rendering the input and both buttons, put it in one non-sortable, non-hideable column headed `"Capacity"`, and drop the separate Actions column.

```tsx
const COLUMNS: AdminColumn<Row>[] = [
  {
    accessorFn: (row) => row.name ?? undefined,
    cell: ({ row }) => row.original.name ?? "(none)",
    enableHiding: false,
    header: "Name",
    id: "name",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.affiliation ?? undefined,
    cell: ({ row }) => row.original.affiliation ?? "(none)",
    header: "Affiliation",
    id: "affiliation",
    sortUndefined: "last",
  },
  {
    accessorFn: (row) => row.email,
    cell: ({ row }) => row.original.email,
    header: "Email",
    id: "email",
  },
  {
    accessorFn: (row) => row.mentorTeamCount,
    cell: ({ row }) => <MentorControls mentor={row.original} />,
    enableHiding: false,
    header: "Capacity",
    id: "capacity",
  },
];
```

Container becomes `px-4 py-6 md:px-8`. Add a search input to the toolbar with the same 300ms debounce used in Task 4. Wire the state with `useAdminTableState` exactly as the other two routes do. `caption` is `"Mentors"`, `emptyMessage` is `"No mentors yet."`, `storageKey` is `"mentors"`, `DEFAULT_SORT` is `{ desc: false, id: "name" }`.

- [ ] **Step 5: Delete the old table component**

```bash
grep -rn "admin-table\|AdminTable" src/ --include="*.tsx" --include="*.ts"
```

Only `src/styles.css` (the class, which stays) should remain. Then:

```bash
# Do NOT run this. AdminTable still has three consumers. See the File Structure correction.
```

- [ ] **Step 6: Run everything**

```bash
ulimit -n 8192; CI=true npm test
ulimit -n 8192; CI=true npm run test:integration
```
Expected: both PASS.

- [ ] **Step 7: Lint, typecheck, commit**

```bash
npm run check && npm run typecheck
git add -A src/server/_internal/users.ts src/server/users.ts src/routes/_authed/admin/mentors/index.tsx src/test/admin-data-table.test.tsx src/components/admin-table.tsx
git commit -m "feat(admin): rebuild the mentors list and delete the old admin table"
```

---

## Task 8: Accessibility pass

**Files:**
- Modify: `src/test/a11y/admin.a11y.test.ts`

**Interfaces:**
- Consumes: all previous tasks.

- [ ] **Step 1: Add the interaction test**

The existing checks at lines 26, 56, and 91 load each page and run `checkA11y` on static markup. Sorting and the column menu are new interactive surfaces that static loads never reach. Add after the existing inventory test:

```ts
test("admin inventory table interactions", async ({ page }) => {
  await page.goto("/admin/inventory");
  await page.getByRole("button", { name: "Columns" }).click();
  await checkA11y(page);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: /Name/ }).click();
  await expect(
    page.getByRole("columnheader", { name: /Name/ })
  ).toHaveAttribute("aria-sort", /ascending|descending/);
  await checkA11y(page);
});
```

Import `expect` from `@playwright/test` if the file does not already.

- [ ] **Step 2: Run the accessibility suite**

```bash
npm run db:seed:dev && npm run db:seed:admin
npm run test:accessibility
```
Expected: PASS on all tests, including the pre-existing static checks for all three rebuilt pages.

Any violation here is a blocker for this task, not something to carry forward. The likely candidates are the caption's DOM position, a missing accessible name on the Columns trigger, and `aria-sort` on a header that is not a `columnheader` role.

- [ ] **Step 3: Final full verification**

```bash
ulimit -n 8192; CI=true npm test
ulimit -n 8192; CI=true npm run test:integration
npm run check
npm run typecheck
```
All four must pass before this task is complete.

- [ ] **Step 4: Commit**

```bash
git add src/test/a11y/admin.a11y.test.ts
git commit -m "test(a11y): cover the admin table's sort and column controls"
```

---

## Deferred, on purpose

The README backlog already records these; they are not part of this plan.

- Row selection and bulk actions, and CSV export of the current selection. The column definitions leave room for a leading selection column, but nothing here builds one.
- Migrating `/admin/users`, `/admin/categories`, and `/admin/programs`. They keep `max-w-4xl` and their current markup.
- Row virtualization. Revisit only if a table passes a few thousand rows, which would also mean moving sorting into `ORDER BY`.

---

# Amendment: the remaining three admin pages

Added after Task 8, at the user's request: `/admin/users`, `/admin/categories`,
and `/admin/programs` move onto the shared table too. This retires the
"Migrate other admin pages to tanstack/table as well" backlog item and finally
makes `src/components/admin-table.tsx` deletable, which the original plan
wrongly assumed Task 7 would achieve.

Two user decisions shape this amendment:

1. **`/admin/users` keeps its server pagination and sorts on the server.** It
   is the one table that can plausibly outgrow a few hundred rows, so it does
   not follow the load-everything approach the other five use.
2. **`/admin/categories` and `/admin/programs` get sorting and column
   visibility only.** No search box, no new filters, no server changes.

### The governing rule, restated

The original rule was "the server decides which rows exist, the client decides
their order and which columns show." Decision 1 refines it:

> **The server decides which rows exist. Where the server paginates, it also
> decides their order.** Column visibility is always client state.

That gives exactly one exception, `/admin/users`, and it is an exception with a
reason rather than an inconsistency: sorting a single page of 20 rows in the
browser would sort 20 of N rows while appearing to sort all of them.

The mechanical consequence is that `sort` and `dir` join `loaderDeps` on that
one route, which is the opposite of what Tasks 4, 6, and 7 required. `cols`
still must not, because column visibility never involves the server.

---

## Task 9: Server-sorted mode

**Files:**
- Modify: `src/components/admin-data-table.tsx`
- Modify: `src/server/_internal/users.ts`
- Modify: `src/server/users.ts`
- Test: `src/test/admin-data-table.test.tsx`
- Test: `src/server/__tests__/admin-users-sort.integration.test.ts` (create)

**Interfaces:**
- Consumes: `AdminDataTableProps` (Task 2), `listUsersImpl` as it stands.
- Produces: an optional `serverSorted?: boolean` prop on `AdminDataTable`, and
  `listUsersImpl` accepting `sort` and `dir`.

- [ ] **Step 1: Write the failing component test**

Add to `src/test/admin-data-table.test.tsx`. Use plain DOM assertions; this
repo has no jest-dom.

```tsx
it("leaves row order to the caller when serverSorted is set", () => {
  const { container } = renderTable({
    hidden: [],
    serverSorted: true,
    sort: { desc: false, id: "name" },
  });
  const names = [...container.querySelectorAll("tbody tr")].map(
    (tr) => tr.querySelector("td")?.textContent
  );
  // DATA order, not sorted order: the server already ordered these rows.
  expect(names).toEqual(["beta", "Alpha", "gamma"]);
});

it("still reports sort changes when serverSorted is set", () => {
  const onSortChange = vi.fn();
  renderTable({ onSortChange, serverSorted: true });
  screen.getByRole("button", { name: /Name/ }).click();
  expect(onSortChange).toHaveBeenCalledWith({ desc: true, id: "name" });
});

it("still marks the sorted column with aria-sort when serverSorted is set", () => {
  renderTable({ serverSorted: true, sort: { desc: true, id: "name" } });
  expect(
    screen.getByRole("columnheader", { name: /Name/ }).getAttribute("aria-sort")
  ).toBe("descending");
});
```

- [ ] **Step 2: Run to verify failure**

`ulimit -n 8192; CI=true npx vitest run src/test/admin-data-table.test.tsx`
Expected: the first test FAILS because rows come back sorted.

- [ ] **Step 3: Implement the prop**

In `AdminDataTableProps`, add `serverSorted?: boolean`. Document it:

```ts
  /**
   * Set when the server already ordered the rows and will reorder them on the
   * next request, which is the case for any paginated listing. Header clicks
   * still report through onSortChange and aria-sort still reflects the current
   * column; only the local reordering is skipped, because sorting one page of
   * rows in the browser would sort a slice while appearing to sort the whole
   * table.
   */
  serverSorted?: boolean;
```

Pass `manualSorting: serverSorted ?? false` to `useReactTable`. Leave
`getSortedRowModel` in place: TanStack ignores it under `manualSorting`.

- [ ] **Step 4: Write the failing server tests**

Create `src/server/__tests__/admin-users-sort.integration.test.ts`. Copy the
`makeAdmin` fixture idiom from the sibling integration tests.

Cover: sorting ascending and descending by `email`; sorting by `name` with a
null name landing **last in both directions**; an unknown `sort` value falling
back to the default `createdAt desc`; and sorting composing with the existing
`role` filter and pagination rather than replacing them.

- [ ] **Step 5: Implement server sorting**

In `src/server/_internal/users.ts`, add `sort` and `dir` to `ListUsersInput`
and build the `ORDER BY` from a whitelist. A whitelist, not a lookup by string,
because an unvalidated column name reaching `ORDER BY` is an injection surface:

```ts
const USER_SORT_COLUMNS = {
  banned: user.banned,
  createdAt: user.createdAt,
  email: user.email,
  name: user.name,
  role: user.role,
} as const;
```

Nulls must sort last in **both** directions, matching what the client-side
tables do. Postgres defaults to `NULLS LAST` for ascending and `NULLS FIRST`
for descending, so descending needs it stated explicitly. Build the clause with
`sql` rather than `asc()`/`desc()` so the null handling is expressible.

Unknown or absent `sort` falls back to `createdAt` descending, which is the
current behavior.

In `src/server/users.ts`, extend `listUsersSchema` with
`sort: z.string().optional()` and `dir: z.enum(["asc", "desc"]).optional()`.

- [ ] **Step 6: Verify**

```
ulimit -n 8192; CI=true npx vitest run src/test/admin-data-table.test.tsx
ulimit -n 8192; CI=true npm run test:integration
npm run check && npm run typecheck
```

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(admin): add server-sorted mode for paginated tables"
```

---

## Task 10: The users route

**Files:**
- Modify: `src/routes/_authed/admin/users/index.tsx`

**Interfaces:** consumes Task 9's `serverSorted` prop and the widened
`listUsers`, plus `useAdminTableState` and `AdminDataTable`.

- [ ] **Step 1: Extend the search schema**

Add `cols`, `dir`, and `sort` as optional fields beside the existing `q`,
`role`, `includeBanned`, and `page`.

- [ ] **Step 2: Fix loaderDeps, with the exception**

This route currently has `loaderDeps: ({ search }) => search`, which Tasks 4
and 6 had to narrow. Here it becomes explicit but **includes** `sort` and
`dir`, because the server does the ordering:

```ts
loaderDeps: ({ search }) => ({
  dir: search.dir,
  includeBanned: search.includeBanned,
  page: search.page,
  q: search.q,
  role: search.role,
  sort: search.sort,
}),
```

`cols` is deliberately absent: column visibility never involves the server.
Write that reason as a comment; it is the single most confusing line in this
file for anyone who read the other four routes first.

- [ ] **Step 3: Columns**

Module-level `COLUMNS` and `DEFAULT_SORT = { desc: true, id: "createdAt" }`.

| Column | id | Default | Notes |
| --- | --- | --- | --- |
| Email | `email` | visible, `enableHiding: false` | |
| Name | `name` | visible | `?? "(none)"` |
| Role | `role` | visible | |
| Banned | `banned` | visible | render "yes" or "" as today |
| Created | `createdAt` | hidden | `LocalTime dateOnly`, `sortingFn: "datetime"` |
| Actions | `actions` | visible, `enableHiding: false`, `enableSorting: false` | the existing Manage link |

Sorting is server-side, so `sortingFn` and `accessorFn` null-mapping are inert
for ordering here. Keep the accessors anyway so the column ids stay meaningful
and the file reads like its four siblings.

- [ ] **Step 4: Wire it**

Follow the shape in `src/routes/_authed/admin/inventory/index.tsx`, with two
differences:

- Pass `serverSorted` to `AdminDataTable`.
- `setSearch` must reset `page` to 1 whenever it changes `sort` or `dir`.
  Changing the sort while on page 5 would otherwise show an arbitrary slice of
  a newly ordered list. The existing filter handlers already reset `page`, so
  follow that precedent.

Keep the Previous/Next block and `totalPages`. Change the container to
`px-4 py-6 md:px-8`.

- [ ] **Step 5: Verify and commit**

Full unit suite, `npm run check`, `npm run typecheck`. Confirm in a browser
that clicking a header re-queries and reorders **across pages**, not just
within the visible 20, and that it returns to page 1.

```bash
git commit -m "feat(admin): rebuild the users list on the shared table"
```

---

## Task 11: The categories and programs routes

**Files:**
- Modify: `src/routes/_authed/admin/categories/index.tsx`
- Modify: `src/routes/_authed/admin/programs/index.tsx`

These two are the simplest of the six: no filters, no pagination, no server
changes, and both already load every row. Each keeps its existing create
dialog in the page header, untouched.

- [ ] **Step 1: Categories**

Add a `validateSearch` schema with just `cols`, `dir`, and `sort`. The route
has none today. No `loaderDeps` change is needed because the loader takes no
filters; leave the loader as it is.

`DEFAULT_SORT = { desc: false, id: "type" }`, matching today's
`orderBy(categories.type, categories.name)` as closely as a single sort key
can.

| Column | id | Default | Notes |
| --- | --- | --- | --- |
| Name | `name` | visible, `enableHiding: false` | |
| Type | `type` | visible | keep the `text-muted-foreground` styling on the cell |
| Created | `createdAt` | hidden | `LocalTime dateOnly`, `sortingFn: "datetime"` |
| Actions | `actions` | visible, `enableHiding: false`, `enableSorting: false` | the existing Edit link |

`caption` is "Categories", `emptyMessage` is "No categories yet.",
`storageKey` is `"categories"`.

- [ ] **Step 2: Programs**

Same treatment. `DEFAULT_SORT = { desc: false, id: "courseId" }`, matching
today's `orderBy(programs.courseId)`.

| Column | id | Default | Notes |
| --- | --- | --- | --- |
| Course ID | `courseId` | visible, `enableHiding: false` | |
| Course name | `courseName` | visible | |
| Description | `description` | hidden | `?? "-"`, nulls last |
| Created | `createdAt` | hidden | `LocalTime dateOnly`, `sortingFn: "datetime"` |
| Updated | `updatedAt` | hidden | `LocalTime dateOnly`, `sortingFn: "datetime"` |
| Actions | `actions` | visible, `enableHiding: false`, `enableSorting: false` | the existing Manage link |

`listProgramsImpl` already does a bare `select()`, so `description`,
`createdAt`, and `updatedAt` are on the rows already. No server change.

`caption` is "Programs", `emptyMessage` is "No programs yet.", `storageKey` is
`"programs"`.

- [ ] **Step 3: Both**

Container becomes `px-4 py-6 md:px-8`. Module-level `COLUMNS` and
`DEFAULT_SORT`. `getRowId={(row) => row.id}`. No `toolbar` prop: neither page
has filters, so the Columns button sits alone, which the shared component
already handles.

- [ ] **Step 4: Verify and commit**

Full unit suite, `npm run check`, `npm run typecheck`, and a browser check that
both create dialogs still work.

```bash
git commit -m "feat(admin): rebuild the categories and programs lists on the shared table"
```

---

## Task 12: Delete AdminTable and extend the accessibility pass

**Files:**
- Delete: `src/components/admin-table.tsx`
- Modify: `src/test/a11y/admin.a11y.test.ts`

- [ ] **Step 1: Confirm there are no consumers**

```bash
grep -rn "AdminTable\b" src/ | grep -v "AdminTableSearch"
```

The only expected hit is the component's own definition. If any route still
imports it, stop and report: a page was missed.

- [ ] **Step 2: Delete it**

```bash
rm src/components/admin-table.tsx
```

Keep the `.admin-table` rules in `src/styles.css`. The shared table still uses
that class name, and those rules are what produce the mobile cards.

- [ ] **Step 3: Extend the accessibility coverage**

Task 8 added an interaction pass for `/admin/inventory`. Extend the same
treatment to the three newly migrated pages: open the Columns menu, run
`checkA11y`, activate a sort header, assert `aria-sort`, run `checkA11y` again.

For `/admin/users` specifically, also assert that activating a sort header
changes the **rows**, not just the URL, since that page round-trips to the
server to reorder. That is the one behavior in this amendment no unit test can
reach.

- [ ] **Step 4: Full verification**

```
ulimit -n 8192; CI=true npm test
ulimit -n 8192; CI=true npm run test:integration
npm run test:accessibility
npm run check
npm run typecheck
```

All five must pass.

- [ ] **Step 5: Commit**

```bash
git commit -m "refactor(admin): delete the superseded AdminTable component"
```
