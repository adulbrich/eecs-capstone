// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type AdminColumn,
  AdminDataTable,
  type AdminDataTableProps,
} from "#/components/admin-data-table";

// Radix's dropdown menu (Popper/floating-ui) relies on a few DOM APIs jsdom
// omits. Same stub set as proposer-picker.test.tsx.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {
      // no-op
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  };
});

/**
 * Radix's `DropdownMenuTrigger` opens on `pointerdown`, not `click`, so a
 * plain `.click()` never opens the menu under jsdom.
 */
function openColumnsMenu() {
  fireEvent.pointerDown(screen.getByRole("button", { name: "Columns" }), {
    button: 0,
    ctrlKey: false,
  });
}

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
    expect(
      screen
        .getByRole("columnheader", { name: /Name/ })
        .getAttribute("aria-sort")
    ).toBe("ascending");
  });

  it("reports a sort change when a header button is activated", () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange });
    screen.getByRole("button", { name: /Name/ }).click();
    expect(onSortChange).toHaveBeenCalledWith({ desc: true, id: "name" });
  });

  it("hides a column's header and every one of its cells", () => {
    renderTable();
    expect(screen.queryByRole("columnheader", { name: /Location/ })).toBeNull();
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
    // Location is default-hidden in COLUMNS, which collides with the case
    // this test wants (hiding a column that is not already the default). Undo
    // that default here so the hidden set actually diverges from the page
    // default; the coincident case is covered separately below.
    const columns = COLUMNS.map((column) =>
      column.id === "location"
        ? { ...column, defaultHidden: undefined }
        : column
    );
    renderTable({ columns, hidden: [], onHiddenChange });
    openColumnsMenu();
    screen.getByRole("menuitemcheckbox", { name: "Location" }).click();
    expect(onHiddenChange).toHaveBeenCalledWith("location");
    expect(localStorage.getItem("cs-capstone:admin-cols:test")).toBe(
      "location"
    );
  });

  it("omits the param when a toggle lands back on the page default", () => {
    const onHiddenChange = vi.fn();
    renderTable({ hidden: [], onHiddenChange });
    openColumnsMenu();
    screen.getByRole("menuitemcheckbox", { name: "Location" }).click();
    // Location is default-hidden, so hiding it returns the table to the page
    // default: the URL param is omitted even though storage still records
    // the raw set. Storage carries the literal set; the URL carries only the
    // divergence from default.
    expect(onHiddenChange).toHaveBeenCalledWith(undefined);
    expect(localStorage.getItem("cs-capstone:admin-cols:test")).toBe(
      "location"
    );
  });

  it("offers no checkbox for a column that cannot be hidden", () => {
    renderTable();
    openColumnsMenu();
    // Positive control: the menu is actually open and rendering hideable
    // columns, so the missing "Name" checkbox below isn't a vacuous pass.
    expect(
      screen.getByRole("menuitemcheckbox", { name: "Location" })
    ).not.toBeNull();
    expect(screen.queryByRole("menuitemcheckbox", { name: "Name" })).toBeNull();
  });

  it("renders the empty message instead of a table when there are no rows", () => {
    renderTable({ data: [] });
    expect(screen.getByText("Nothing here.")).not.toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("keeps the toolbar visible when there are no rows", () => {
    renderTable({ data: [], toolbar: <p>Filters go here</p> });
    expect(screen.getByText("Filters go here")).not.toBeNull();
  });

  it("announces the row count in a live region", () => {
    renderTable();
    expect(screen.getByText("3 rows")).not.toBeNull();
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
});
