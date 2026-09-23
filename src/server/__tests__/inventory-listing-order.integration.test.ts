import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { inventoryItems } from "#/db/schema";
import { listInventoryAs } from "#/server/_internal/inventory-catalog";
import type { InventoryOrder } from "#/server/inventory";

/**
 * The inventory half of `listing-order.integration.test.ts`, and the same
 * property: `listInventoryAs` runs each page as its own `LIMIT`/`OFFSET`
 * query, so an ordering that leaves rows tied lets an item appear on two
 * pages and another on none (#477).
 *
 * The row count and the page size are load-bearing for the reason "Paging a
 * listing needs a total ordering" in docs/QUIRKS.md gives. Do not trim them.
 */
const TIED_AT = new Date("2026-03-01T12:00:00.000Z");
const ROW_COUNT = 400;
const PAGE_SIZE = 20;

/**
 * `ROW_COUNT` items that tie on every key any ordering reads: one status, one
 * name and one `updated_at`, which is what a batch written in one
 * transaction looks like. Only the id separates them.
 */
async function insertTiedItems() {
  const rows = await db
    .insert(inventoryItems)
    .values(
      Array.from({ length: ROW_COUNT }, () => ({
        name: "Tied cohort item",
        status: "available" as const,
        updatedAt: TIED_AT,
      }))
    )
    .returning({ id: inventoryItems.id });
  return rows.map((row) => row.id);
}

const LIST_DEFAULTS = {
  categories: [],
  pageSize: PAGE_SIZE,
  q: "",
  status: null,
};

/** Every id the listing hands back, page by page, in page order. */
async function pageThrough(order: InventoryOrder) {
  const seen: string[] = [];
  const first = await listInventoryAs(null, {
    ...LIST_DEFAULTS,
    order,
    page: 1,
  });
  const pages = Math.ceil(first.total / PAGE_SIZE);
  seen.push(...first.rows.map((row) => row.id));
  for (let page = 2; page <= pages; page++) {
    const next = await listInventoryAs(null, {
      ...LIST_DEFAULTS,
      order,
      page,
    });
    seen.push(...next.rows.map((row) => row.id));
  }
  return seen;
}

function expectVisitsEachExactlyOnce(seen: string[], expected: string[]) {
  expect(new Set(seen).size).toBe(seen.length);
  expect([...seen].sort()).toEqual([...expected].sort());
}

describe("paging the inventory listing when items tie on every sort key", () => {
  for (const order of ["available", "name", "updated"] as const) {
    it(`visits each item exactly once under ${order}`, async () => {
      const ids = await insertTiedItems();
      expectVisitsEachExactlyOnce(await pageThrough(order), ids);
    });
  }
});

describe("the inventory listing's orderings", () => {
  /**
   * Four items whose three orderings all disagree, so each assertion below
   * fails if its ordering reads the wrong key. Lowercase "arduino" is there
   * to pin case folding: under a byte-order sort it lands after "Zebra".
   */
  async function insertMixed() {
    await db.insert(inventoryItems).values([
      {
        name: "Zebra board",
        status: "available",
        updatedAt: new Date("2026-04-01T00:00:00.000Z"),
      },
      {
        name: "arduino",
        status: "checked_out",
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        name: "Multimeter",
        status: "available",
        updatedAt: new Date("2026-03-01T00:00:00.000Z"),
      },
      {
        name: "Bench supply",
        status: "maintenance",
        updatedAt: new Date("2026-02-01T00:00:00.000Z"),
      },
    ]);
  }

  async function names(order: InventoryOrder) {
    // No filtering and no cleanup: `setup.integration.ts` truncates in
    // `beforeEach`, so these four are the only items that exist.
    const { rows } = await listInventoryAs(null, {
      ...LIST_DEFAULTS,
      order,
      page: 1,
    });
    return rows.map((row) => row.name);
  }

  it("puts available items first, then the lifecycle, then the name", async () => {
    await insertMixed();
    expect(await names("available")).toEqual([
      "Multimeter",
      "Zebra board",
      "arduino",
      "Bench supply",
    ]);
  });

  it("orders by name without regard to case", async () => {
    await insertMixed();
    expect(await names("name")).toEqual([
      "arduino",
      "Bench supply",
      "Multimeter",
      "Zebra board",
    ]);
  });

  it("orders by most recently updated", async () => {
    await insertMixed();
    expect(await names("updated")).toEqual([
      "Zebra board",
      "Multimeter",
      "Bench supply",
      "arduino",
    ]);
  });
});
