// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminTableSearch, SortState } from "../table-state";
import { useAdminTable } from "../use-admin-table";

const COLUMNS = [{ id: "name" }, { id: "createdAt" }];
const DEFAULT_SORT: SortState = { desc: false, id: "name" };

/**
 * A paginated route's search. `page` is what makes `resetPageOnSort` legal.
 *
 * Annotated rather than inferred: `AdminTableSearch` is all-optional, so a bare
 * `{ page: 1 }` shares no property with it and TypeScript's weak-type check
 * rejects it. A real route's schema declares `cols`, `dir` and `sort` alongside
 * `page`, so it satisfies the constraint without help.
 */
const PAGED_SEARCH: AdminTableSearch & { page: number } = { page: 1 };

/** The other half: a route that paginates nothing. */
const UNPAGED_SEARCH: AdminTableSearch = { sort: "name" };

/**
 * `search` carries a `page`, because `resetPageOnSort` is typed `never` without
 * one. That constraint is the subject of its own test at the bottom of this
 * file rather than something to work around silently here.
 */
function setup(extra: { resetPageOnSort?: boolean } = {}) {
  const navigate = vi.fn();
  const { result } = renderHook(() =>
    useAdminTable({
      columns: COLUMNS,
      defaultSort: DEFAULT_SORT,
      navigate,
      search: PAGED_SEARCH,
      storageKey: "test-table",
      ...extra,
    })
  );
  return { navigate, result };
}

/** Runs the search reducer from the most recent navigate call. */
function lastPatch(navigate: ReturnType<typeof vi.fn>, prev: object) {
  const call = navigate.mock.calls.at(-1)?.[0] as {
    search: (p: object) => Record<string, unknown>;
  };
  return call.search(prev);
}

beforeEach(() => {
  localStorage.clear();
});

describe("useAdminTable", () => {
  it("sends a sort change back to page one when asked", () => {
    const { navigate, result } = setup({ resetPageOnSort: true });

    act(() =>
      result.current.tableProps.onSortChange({ desc: true, id: "createdAt" })
    );

    expect(lastPatch(navigate, { page: 4 })).toMatchObject({
      dir: "desc",
      page: 1,
      sort: "createdAt",
    });
  });

  it("resets the page when a sort returns to the default, too", () => {
    // The case `serializeSort` keeps always-present `sort`/`dir` keys for.
    // Restoring the default clears both params, so the patch carries
    // `undefined` values, and a reset keyed on the values rather than on
    // `"sort" in patch` would silently skip this one.
    const { navigate, result } = setup({ resetPageOnSort: true });

    act(() => result.current.tableProps.onSortChange(DEFAULT_SORT));

    expect(lastPatch(navigate, { page: 4 })).toMatchObject({ page: 1 });
  });

  it("leaves the page alone when a route did not ask", () => {
    const { navigate, result } = setup();

    act(() =>
      result.current.tableProps.onSortChange({ desc: true, id: "createdAt" })
    );

    expect(lastPatch(navigate, { page: 4 })).toMatchObject({ page: 4 });
  });

  it("does not reset the page when only column visibility changes", () => {
    // Hiding a column re-renders the same rows in the same order, so the
    // reader's page still means what it meant.
    const { navigate, result } = setup({ resetPageOnSort: true });

    act(() => result.current.tableProps.onHiddenChange("createdAt"));

    expect(lastPatch(navigate, { page: 4 })).toMatchObject({
      cols: "createdAt",
      page: 4,
    });
  });

  it("hands the table the same columns, sort default and storage key it was given", () => {
    // The agreements this hook exists to remove: these three used to be
    // passed once to the state hook and again to the table, by hand, in six
    // routes.
    const { result } = setup();

    expect(result.current.tableProps).toMatchObject({
      columns: COLUMNS,
      defaultSort: DEFAULT_SORT,
      storageKey: "test-table",
    });
  });

  it("refuses resetPageOnSort on a route whose search has no page", () => {
    // A type-level test, and the only assertion here that #96 is actually
    // about. The runtime cases above all pass with the constraint removed;
    // this one stops compiling, which is the point. `@ts-expect-error` fails
    // the build if the line ever becomes legal again.
    //
    // The reason it needs to be a type test: threading the route's search type
    // through `navigate` does not catch this on its own. The search reducer
    // spreads over a generic, TypeScript cannot prove that preserves the
    // generic, and the cast that makes it compile is exactly what stops the
    // compiler from noticing a stray `page`.
    const navigate = vi.fn();
    renderHook(() =>
      useAdminTable({
        columns: COLUMNS,
        defaultSort: DEFAULT_SORT,
        navigate,
        // @ts-expect-error resetPageOnSort is `never` without a `page` param
        resetPageOnSort: true,
        search: UNPAGED_SEARCH,
        storageKey: "test-table",
      })
    );
  });
});
