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
import { orderBySortedIds, toCsv } from "#/lib/csv";

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

  it("omits aria-sort entirely on a header that cannot be sorted", () => {
    const columns: AdminColumn<Row>[] = [
      ...COLUMNS,
      {
        cell: () => "Edit",
        enableHiding: false,
        enableSorting: false,
        header: "Actions",
        id: "actions",
      },
    ];
    renderTable({ columns, hidden: [] });
    // Not "none": that value tells assistive tech this header participates
    // in sorting and simply isn't the active one, which is false for a
    // column that can never be sorted.
    expect(
      screen
        .getByRole("columnheader", { name: "Actions" })
        .getAttribute("aria-sort")
    ).toBeNull();
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

  it("drops the field label on a cardHeader column and marks it instead", () => {
    // The mobile card draws each field name from data-label. The column that
    // titles the record must not carry one, or the card header renders as a
    // labelled field with the title squeezed in beside it.
    const columns = COLUMNS.map((column) =>
      column.id === "name" ? { ...column, cardHeader: true } : column
    );
    const { container } = renderTable({ columns, hidden: [] });
    const cells = container
      .querySelectorAll("tbody tr")[0]
      .querySelectorAll("td");

    expect(cells[0].getAttribute("data-label")).toBeNull();
    expect(cells[0].hasAttribute("data-card-header")).toBe(true);
    // Every other column keeps its label, so the marking is opt-in per column
    // rather than "the first cell is special".
    expect(cells[1].getAttribute("data-label")).toBe("Location");
    expect(cells[1].hasAttribute("data-card-header")).toBe(false);
  });

  it("keeps every cell labelled when no column opts into cardHeader", () => {
    const { container } = renderTable({ hidden: [] });
    const cells = container
      .querySelectorAll("tbody tr")[0]
      .querySelectorAll("td");
    for (const cell of cells) {
      expect(cell.hasAttribute("data-card-header")).toBe(false);
    }
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

  it("omits the param and clears storage when a toggle lands back on the page default", () => {
    const onHiddenChange = vi.fn();
    localStorage.setItem("cs-capstone:admin-cols:test", "somethingElse");
    renderTable({ hidden: [], onHiddenChange });
    openColumnsMenu();
    screen.getByRole("menuitemcheckbox", { name: "Location" }).click();
    // Location is default-hidden, so hiding it returns the table to the page
    // default: the URL param is omitted. Storage must be cleared, not
    // written with the literal default set. A stored copy of the default is
    // indistinguishable from "the user has a preference that happens to
    // match the default," and the seed effect that reads storage on the next
    // param-less render would write it straight back into the URL, undoing
    // the clean URL this same toggle just produced.
    expect(onHiddenChange).toHaveBeenCalledWith(undefined);
    expect(localStorage.getItem("cs-capstone:admin-cols:test")).toBeNull();
  });

  it("clears the stored preference and reports undefined when Reset columns is activated", () => {
    const onHiddenChange = vi.fn();
    // A real, non-default stored preference, so a fix that regresses to
    // writing the literal default set back (instead of clearing the key)
    // still leaves a truthy value here and this test catches it.
    localStorage.setItem("cs-capstone:admin-cols:test", "location");
    renderTable({ hidden: ["location"], onHiddenChange });
    openColumnsMenu();
    screen.getByRole("menuitem", { name: "Reset columns" }).click();
    expect(onHiddenChange).toHaveBeenCalledWith(undefined);
    expect(localStorage.getItem("cs-capstone:admin-cols:test")).toBeNull();
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

  it("announces the row count and the current sort order in a live region", () => {
    renderTable();
    expect(
      screen.getByText("3 rows, sorted by Name, ascending")
    ).not.toBeNull();
  });

  it("announces the sort order even when the sorted column is hidden", () => {
    // Location is hidden by `renderTable`'s default `hidden` prop, so its
    // header (and the aria-sort it would carry) never reaches the DOM. The
    // live region is the only surface left that can say the table is
    // ordered by it at all.
    renderTable({ sort: { desc: true, id: "location" } });
    expect(
      screen.getByText("3 rows, sorted by Location, descending")
    ).not.toBeNull();
    expect(screen.queryByRole("columnheader", { name: /Location/ })).toBeNull();
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

  it("sorts an accented name among its unaccented peers, not after 'z'", () => {
    // Differential: under TanStack's built-in "text" sortingFn
    // (compareBasic on lowercased strings), this would come out
    // ["Adam", "Zoe", "Émile"], because "é" (U+00E9) compares greater than
    // "z" (U+007A) by code point. Under localeCompare/Intl.Collator with
    // `sensitivity: "base"`, accented letters sort among their unaccented
    // peers instead, which is what a reader actually expects.
    const accentedRows: Row[] = [
      { id: "1", location: null, name: "Zoe" },
      { id: "2", location: null, name: "Émile" },
      { id: "3", location: null, name: "Adam" },
    ];
    const { container } = renderTable({ data: accentedRows, hidden: [] });
    const names = [...container.querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelector("td")?.textContent
    );
    expect(names).toEqual(["Adam", "Émile", "Zoe"]);
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

  it("reports sorted row ids that reproduce the on-screen order in an export", () => {
    // Sort by "location" instead of the "name" default. Ascending location
    // (nulls last) orders the three DATA rows id 3, 1, 2 -- different from
    // both the natural DATA order (1, 2, 3) and the name-sorted default
    // order (2, 1, 3), so this is decisive: a regression that reported
    // `data`'s own order, or the default sort's order, instead of the
    // table's actual sorted row model would produce a different sequence
    // and this test would catch it.
    const onSortedIdsChange = vi.fn();
    const { container } = renderTable({
      hidden: [],
      onSortedIdsChange,
      sort: { desc: false, id: "location" },
    });

    const renderedIds = [...container.querySelectorAll("tbody tr")].map(
      (tr) =>
        DATA.find((row) => row.name === tr.querySelector("td")?.textContent)?.id
    );
    // Positive control: the render itself is actually reordered, so a later
    // failure of the assertion below is about the reported ids diverging
    // from the screen, not about the fixture failing to exercise sorting.
    expect(renderedIds).toEqual(["3", "1", "2"]);

    expect(onSortedIdsChange).toHaveBeenLastCalledWith(renderedIds);

    // Compose with the export helpers directly: ordering the source rows by
    // the reported id sequence and serializing them must reproduce exactly
    // the order rendered on screen, which is the guarantee Fix 1 exists for.
    const lastCallIds = onSortedIdsChange.mock.calls.at(-1)?.[0] as string[];
    const exportOrder = orderBySortedIds(DATA, lastCallIds, (row) => row.id);
    const csv = toCsv(
      [{ header: "Name", value: (row: Row) => row.name }],
      exportOrder
    );
    expect(csv.split("\r\n").slice(1)).toEqual(["gamma", "beta", "Alpha"]);
  });

  it("does not report sorted ids when serverSorted is set", () => {
    const onSortedIdsChange = vi.fn();
    renderTable({ onSortedIdsChange, serverSorted: true });
    expect(onSortedIdsChange).not.toHaveBeenCalled();
  });

  it("leaves row order to the caller when serverSorted is set", () => {
    const { container } = renderTable({
      hidden: [],
      serverSorted: true,
      sort: { desc: false, id: "name" },
    });
    const names = [...container.querySelectorAll("tbody tr")].map(
      (tr) => tr.querySelector("td")?.textContent
    );
    // DATA order, not sorted order: the server already ordered these rows.
    expect(names).toEqual(["beta", "Alpha", "gamma"]);
  });

  it("still reports sort changes when serverSorted is set", () => {
    const onSortChange = vi.fn();
    renderTable({ onSortChange, serverSorted: true });
    screen.getByRole("button", { name: /Name/ }).click();
    expect(onSortChange).toHaveBeenCalledWith({ desc: true, id: "name" });
  });

  it("still marks the sorted column with aria-sort when serverSorted is set", () => {
    renderTable({ serverSorted: true, sort: { desc: true, id: "name" } });
    expect(
      screen
        .getByRole("columnheader", { name: /Name/ })
        .getAttribute("aria-sort")
    ).toBe("descending");
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

describe("highlightedRowId", () => {
  function highlightedRows() {
    return screen
      .getAllByRole("row")
      .filter((row) => row.hasAttribute("data-highlighted"));
  }

  it("marks the named row and no other", () => {
    renderTable({ highlightedRowId: "3" });

    const marked = highlightedRows();
    expect(marked).toHaveLength(1);
    expect(within(marked[0]).getByText("gamma")).toBeTruthy();
  });

  it("marks nothing when the id matches no row", () => {
    // A stale ?line= link naming a row that no longer exists must degrade to
    // the plain table rather than throwing or marking an arbitrary row.
    renderTable({ highlightedRowId: "no-such-row" });

    expect(highlightedRows()).toHaveLength(0);
  });

  it("scrolls the highlighted row into view", () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    renderTable({ highlightedRowId: "3" });

    // A queue can run to many rows, so landing on the page without this leaves
    // staff hunting for the very row the link named.
    expect(scrollIntoView).toHaveBeenCalled();
  });
});
