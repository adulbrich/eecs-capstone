import { describe, expect, it } from "vitest";
import {
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
