import { describe, expect, it } from "vitest";
import {
  filterMyItems,
  isOpenRow,
  MY_ITEMS_FILTERS,
  matchesMyItemsFilter,
} from "../my-items-filter";

const request = (status: string) => ({
  kind: "request" as const,
  line: { status },
});

describe("isOpenRow", () => {
  it("counts the borrow list and a hold as open, whatever the item's status", () => {
    expect(isOpenRow({ kind: "cart" })).toBe(true);
    expect(isOpenRow({ kind: "hold" })).toBe(true);
  });

  it("counts a pending or approved line as open and the three endings as closed", () => {
    expect(isOpenRow(request("pending"))).toBe(true);
    expect(isOpenRow(request("approved"))).toBe(true);
    expect(isOpenRow(request("rejected"))).toBe(false);
    expect(isOpenRow(request("cancelled"))).toBe(false);
    expect(isOpenRow(request("returned"))).toBe(false);
  });
});

describe("matchesMyItemsFilter", () => {
  it("offers open first, so a bare URL lands on what still matters", () => {
    expect(MY_ITEMS_FILTERS[0]).toBe("open");
  });

  it("splits the rows two ways and all shows everything", () => {
    const rows = [
      { kind: "cart" as const },
      request("approved"),
      request("returned"),
      { kind: "hold" as const },
    ];
    expect(rows.filter((r) => matchesMyItemsFilter(r, "open"))).toEqual([
      rows[0],
      rows[1],
      rows[3],
    ]);
    expect(rows.filter((r) => matchesMyItemsFilter(r, "closed"))).toEqual([
      rows[2],
    ]);
    expect(rows.filter((r) => matchesMyItemsFilter(r, "all"))).toEqual(rows);
  });
});

describe("custom lines", () => {
  const custom = (id: string, status: string) => ({
    kind: "custom" as const,
    line: { id, status },
  });

  it("counts pending and sourcing as open, and fulfilled with the endings", () => {
    expect(isOpenRow(custom("c", "pending"))).toBe(true);
    expect(isOpenRow(custom("c", "sourcing"))).toBe(true);
    expect(isOpenRow(custom("c", "fulfilled"))).toBe(false);
    expect(isOpenRow(custom("c", "rejected"))).toBe(false);
    expect(isOpenRow(custom("c", "cancelled"))).toBe(false);
  });

  it("keeps a fulfilled line visible under open while the item it reserved is", () => {
    // A fulfilled line is closed; the hold it produced is open. Under the
    // default filter the item must not appear with nothing above it saying
    // which request produced it.
    const rows = [
      custom("done", "fulfilled"),
      { kind: "hold" as const, viaCustomLineId: "done" },
      custom("gone", "rejected"),
      { kind: "hold" as const, viaCustomLineId: null },
    ];
    expect(filterMyItems(rows, "open")).toEqual([rows[0], rows[1], rows[3]]);
    expect(filterMyItems(rows, "closed")).toEqual([rows[0], rows[2]]);
    expect(filterMyItems(rows, "all")).toEqual(rows);
  });
});
