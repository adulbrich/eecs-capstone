// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// The route module is rewritten by the TanStack Start plugin, which injects
// its own router imports, so this partially mocks the module: only Link is
// replaced, with a plain anchor, because the cells render links and the
// table itself is fully controlled and needs no router.
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
import { buildColumns, searchSchema } from "#/routes/_authed/my/items";

afterEach(cleanup);

const columns = buildColumns({
  busy: false,
  onCancel: vi.fn(),
  onOpen: vi.fn(),
  onRemove: vi.fn(),
});

describe("/my/items search", () => {
  it("opens on open when the URL says nothing", () => {
    expect(searchSchema.parse({})).toEqual({ filter: "open" });
  });

  it("carries no sort or hidden-column keys", () => {
    // A URL naming a sort no column accepts could only mislead, and a sort
    // would drop the grouping and the Submit button on the borrow list's
    // header with it (docs/QUIRKS.md, Inventory).
    expect(Object.keys(searchSchema.shape)).toEqual(["filter"]);
  });
});

describe("/my/items columns", () => {
  it("declares every column unsortable and unhideable", () => {
    for (const column of columns) {
      expect(column.enableSorting, column.id).toBe(false);
      expect(column.enableHiding, column.id).toBe(false);
    }
  });

  it("renders no column picker and no sort buttons", () => {
    render(
      <AdminDataTable
        caption="My items"
        columns={columns}
        data={[
          {
            itemId: "i1",
            itemName: "Oscilloscope",
            itemStatus: "available",
            kind: "cart",
          },
        ]}
        defaultSort={{ desc: false, id: "item" }}
        emptyMessage="Nothing here yet."
        getRowId={(row) => (row.kind === "cart" ? `cart:${row.itemId}` : "")}
        hidden={[]}
        onHiddenChange={vi.fn()}
        onSortChange={vi.fn()}
        sort={{ desc: false, id: "item" }}
        storageKey="my-items-test"
      />
    );
    expect(screen.queryByRole("button", { name: "Columns" })).toBeNull();
    for (const header of screen.getAllByRole("columnheader")) {
      expect(header.querySelector("button")).toBeNull();
    }
    expect(screen.getByRole("button", { name: "Remove" })).toBeDefined();
  });
});
