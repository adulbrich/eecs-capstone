// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, within } from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { session } = vi.hoisted(() => ({
  session: { data: null as null | { user: { id: string } } },
}));
vi.mock("#/lib/auth-client", () => ({
  authClient: { useSession: () => session },
}));
vi.mock("#/server/inventory", () => ({
  addToCart: vi.fn(),
  getCart: () => Promise.resolve([]),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    params: _params,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    params?: unknown;
    to: string;
  } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { AdminDataTable } from "#/components/admin-data-table";
import {
  INVENTORY_TABLE_COLUMNS,
  INVENTORY_TABLE_DEFAULT_SORT,
  type InventoryListRow,
} from "#/components/inventory-table-columns";

beforeEach(() => {
  session.data = { user: { id: "u1" } };
});
afterEach(cleanup);

const ROWS: InventoryListRow[] = [
  {
    categories: [{ id: "c1", name: "Electronics" }],
    description: "Two channels, 100 MHz.",
    dueAt: null,
    id: "i1",
    imageUrl: "inventory/i1/a.webp",
    name: "Oscilloscope",
    pickupBy: null,
    status: "available",
  },
  {
    categories: [],
    description: null,
    dueAt: new Date("2026-10-01"),
    id: "i2",
    imageUrl: null,
    name: "Drill",
    pickupBy: null,
    status: "checked_out",
  },
];

const DEFAULT_HIDDEN = INVENTORY_TABLE_COLUMNS.filter(
  (column) => column.defaultHidden
).map((column) => column.id);

function renderTable(hidden: string[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <AdminDataTable
        caption="Inventory"
        columns={INVENTORY_TABLE_COLUMNS}
        data={ROWS}
        defaultSort={INVENTORY_TABLE_DEFAULT_SORT}
        emptyMessage="Nothing."
        getRowId={(row) => row.id}
        hidden={hidden}
        onHiddenChange={() => {
          // controlled by the route in production
        }}
        onSortChange={() => {
          // controlled by the route in production
        }}
        sort={INVENTORY_TABLE_DEFAULT_SORT}
        storageKey="test"
      />
    </QueryClientProvider>
  );
}

function rowFor(name: string) {
  const row = screen.getByRole("link", { name }).closest("tr");
  if (!row) {
    throw new Error(`no row for ${name}`);
  }
  return within(row);
}

describe("the public inventory table", () => {
  it("shows name, status and categories, and hides the description", () => {
    expect(DEFAULT_HIDDEN).toEqual(["description"]);
    renderTable(DEFAULT_HIDDEN);
    expect(
      screen.getAllByRole("columnheader").map((h) => h.textContent?.trim())
    ).toEqual(["Name", "Status", "Categories"]);
    // The hold dates are in publicItemView and deliberately not here.
    const ids = INVENTORY_TABLE_COLUMNS.map((c) => c.id);
    expect(ids).not.toContain("dueAt");
    expect(ids).not.toContain("pickupBy");
  });

  it("sorts by name by default, since updatedAt is a staff column", () => {
    expect(INVENTORY_TABLE_DEFAULT_SORT).toEqual({ desc: false, id: "name" });
    renderTable(DEFAULT_HIDDEN);
    const names = screen
      .getAllByRole("link")
      .map((link) => link.textContent?.trim());
    expect(names).toEqual(["Drill", "Oscilloscope"]);
  });

  it("renders the status badge and category chips", () => {
    renderTable(DEFAULT_HIDDEN);
    const row = rowFor("Oscilloscope");
    expect(row.getByText("Available")).toBeTruthy();
    expect(
      row.getByText("Electronics").closest('[data-slot="badge"]')
    ).not.toBeNull();
    expect(rowFor("Drill").getByText("Checked out")).toBeTruthy();
  });

  it("clamps the description once it is shown", () => {
    renderTable([]);
    const cell = rowFor("Oscilloscope").getByText("Two channels, 100 MHz.");
    expect(cell.className).toContain("line-clamp-3");
    expect(cell.className).toContain("max-w-xs");
  });

  it("puts the thumbnail and the add-to-cart control in the Name cell, for an available item only", async () => {
    renderTable(DEFAULT_HIDDEN);
    const name = screen
      .getByRole("link", { name: "Oscilloscope" })
      .closest("td");
    if (!name) {
      throw new Error("no name cell");
    }
    expect(name.getAttribute("data-card-header")).not.toBeNull();
    expect(name.querySelector("img")?.getAttribute("src")).toContain(
      "inventory/i1/a.webp"
    );
    const add = await within(name).findByRole("button", {
      name: "Add to borrow list",
    });
    expect(add.closest("a")).toBeNull();
    expect(rowFor("Drill").queryByRole("button")).toBeNull();
  });

  it("renders no control for a signed-out viewer", async () => {
    session.data = null;
    renderTable(DEFAULT_HIDDEN);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      screen.queryByRole("button", { name: "Add to borrow list" })
    ).toBeNull();
  });
});
