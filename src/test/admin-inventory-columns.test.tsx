// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The route module is rewritten by the TanStack Start plugin, which injects
// its own router imports, so this partially mocks the module: only Link is
// replaced, with a plain anchor, because the cells render links and the table
// itself is fully controlled and needs no router.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  Link: ({
    children,
    params: _params,
    search: _search,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    params?: unknown;
    search?: unknown;
    to: string;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { AdminDataTable } from "#/components/admin-data-table";
import type { InventoryItemStaff } from "#/lib/inventory-visibility";
import { COLUMNS, DEFAULT_SORT } from "#/routes/_authed/admin/inventory/index";

afterEach(cleanup);

function itemOf(overrides: Partial<InventoryItemStaff>): InventoryItemStaff {
  return {
    categories: [],
    createdAt: new Date("2026-01-01T00:00:00Z"),
    currentHolderEmail: null,
    currentHolderId: null,
    currentHolderLabel: null,
    currentHolderName: null,
    currentHolderProgram: null,
    currentRequestItemId: null,
    description: null,
    dueAt: null,
    id: "i0",
    imageUrl: null,
    label: null,
    location: null,
    name: "Item",
    notes: null,
    pickupBy: null,
    serial: null,
    status: "available",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

const ROWS: InventoryItemStaff[] = [
  itemOf({
    categories: [{ id: "c1", name: "Electronics" }],
    currentHolderEmail: "sam@oregonstate.edu",
    currentHolderId: "u1",
    currentHolderName: "Sam Rivera",
    currentRequestItemId: "r1",
    dueAt: new Date("2026-03-01T00:00:00Z"),
    id: "i1",
    label: "EECS-004",
    location: "Kelley 1005",
    name: "Oscilloscope",
    serial: "SN-1",
    status: "checked_out",
    updatedAt: new Date("2026-02-01T00:00:00Z"),
  }),
  itemOf({
    id: "i2",
    name: "Drill",
    updatedAt: new Date("2026-02-05T00:00:00Z"),
  }),
];

const DEFAULT_HIDDEN = COLUMNS.filter((column) => column.defaultHidden).map(
  (column) => column.id
);

function renderTable(hidden: string[] = DEFAULT_HIDDEN) {
  return render(
    <AdminDataTable
      caption="Inventory"
      columns={COLUMNS}
      data={ROWS}
      defaultSort={DEFAULT_SORT}
      emptyMessage="No items."
      getRowId={(row) => row.id}
      hidden={hidden}
      onHiddenChange={() => {
        // the route owns this in production
      }}
      onSortChange={() => {
        // the route owns this in production
      }}
      sort={DEFAULT_SORT}
      storageKey="test"
    />
  );
}

function headers() {
  return screen
    .getAllByRole("columnheader")
    .map((header) => header.textContent?.trim());
}

function rowFor(name: string) {
  const row = screen.getByRole("link", { name }).closest("tr");
  if (!row) {
    throw new Error(`no row for ${name}`);
  }
  return within(row);
}

describe("the staff inventory table", () => {
  it("declares every column the page means to offer, in order", () => {
    expect(COLUMNS.map((column) => column.id)).toEqual([
      "name",
      "status",
      "holder",
      "reservedFor",
      "request",
      "location",
      "category",
      "label",
      "serial",
      "dueAt",
      "updatedAt",
      "createdAt",
      "actions",
    ]);
  });

  it("starts with label, serial and created hidden, and the rest shown", () => {
    expect(DEFAULT_HIDDEN).toEqual(["label", "serial", "createdAt"]);
    renderTable();
    expect(headers()).toEqual([
      "Name",
      "Status",
      "Holder",
      "Reserved for",
      "Request",
      "Location",
      "Category",
      "Due",
      "Updated",
      "Actions",
    ]);
  });

  it("sorts by Updated, newest first, and shows the column it sorts by", () => {
    expect(DEFAULT_SORT).toEqual({ desc: true, id: "updatedAt" });
    expect(DEFAULT_HIDDEN).not.toContain("updatedAt");
    renderTable();
    const names = screen
      .getAllByRole("row")
      .slice(1)
      .map((row) => within(row).getAllByRole("link")[0]?.textContent?.trim());
    expect(names).toEqual(["Drill", "Oscilloscope"]);
  });

  it("keeps Name and Actions out of the Columns menu", () => {
    const pinned = COLUMNS.filter(
      (column) => column.enableHiding === false
    ).map((column) => column.id);
    expect(pinned).toEqual(["name", "actions"]);
  });

  it("carries the route's own fields in the columns hidden by default", () => {
    renderTable([]);
    expect(headers()).toContain("Label");
    expect(headers()).toContain("Serial");
    expect(headers()).toContain("Created");
    expect(rowFor("Oscilloscope").getByText("EECS-004")).toBeTruthy();
    expect(rowFor("Oscilloscope").getByText("SN-1")).toBeTruthy();
  });

  it("names the holder and links the request line behind a held item", () => {
    renderTable();
    const row = rowFor("Oscilloscope");
    expect(row.getByText(/Sam Rivera/)).toBeTruthy();
    expect(
      row.getByRole("link", { name: "View request" }).getAttribute("href")
    ).toBe("/admin/inventory/requests");
  });

  it("dashes each empty cell of an unheld item rather than leaving it blank", () => {
    renderTable();
    const row = screen.getByRole("link", { name: "Drill" }).closest("tr");
    if (!row) {
      throw new Error("no row for Drill");
    }
    // By name rather than by count, so a column added to the page does not
    // fail this for a reason that has nothing to do with the dash.
    for (const label of [
      "Holder",
      "Reserved for",
      "Request",
      "Location",
      "Category",
      "Due",
    ]) {
      expect(row.querySelector(`[data-label="${label}"]`)?.textContent).toBe(
        "-"
      );
    }
  });
});
