// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SortState } from "../table-state";
import { useAdminTable } from "../use-admin-table";

const COLUMNS = [{ id: "name" }, { id: "createdAt" }];
const DEFAULT_SORT: SortState = { desc: false, id: "name" };

function setup(extra: { resetPageOnSort?: boolean } = {}) {
  const navigate = vi.fn();
  const { result } = renderHook(() =>
    useAdminTable({
      columns: COLUMNS,
      defaultSort: DEFAULT_SORT,
      navigate,
      search: {},
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
});
