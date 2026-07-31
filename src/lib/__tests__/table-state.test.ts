// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearStoredHidden,
  parseHidden,
  parseSort,
  readStoredHidden,
  serializeHidden,
  serializeSort,
  useAdminTableState,
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

  it("removes a stored preference entirely, distinct from an empty set", () => {
    writeStoredHidden("inventory", ["serial", "label"]);
    clearStoredHidden("inventory");
    // null ("no preference, use the page default") is not the same answer as
    // [] ("deliberately show everything"): useSeedColumnsFromStorage branches
    // on exactly this distinction, so a clear must produce null, not [].
    expect(readStoredHidden("inventory")).toBeNull();
  });

  it("leaves other pages' stored preferences alone", () => {
    writeStoredHidden("inventory", ["serial"]);
    writeStoredHidden("projects", ["contact"]);
    clearStoredHidden("inventory");
    expect(readStoredHidden("inventory")).toBeNull();
    expect(readStoredHidden("projects")).toEqual(["contact"]);
  });

  it("is a no-op when nothing was stored", () => {
    expect(() => clearStoredHidden("inventory")).not.toThrow();
    expect(readStoredHidden("inventory")).toBeNull();
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

  it("does not seed after a stored preference has been cleared", () => {
    // Regression coverage for the resetColumns bug: writing the default set
    // to storage instead of clearing it leaves a "preference" on record, and
    // this effect dutifully seeds it back the next time cols is undefined.
    // Clearing storage (rather than writing the default set into it) is what
    // keeps a reset table's URL clean on the very next render.
    writeStoredHidden("inventory", ["serial"]);
    clearStoredHidden("inventory");
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
