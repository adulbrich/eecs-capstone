// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  INVENTORY_ORDER_LABEL,
  InventoryFilters,
  InventorySearchBar,
} from "#/components/inventory-filters";

afterEach(cleanup);

// Radix Select scrolls the checked option into view on open, which jsdom
// does not implement.
Element.prototype.scrollIntoView = vi.fn();

function renderSearch(
  overrides: Partial<Parameters<typeof InventorySearchBar>[0]> = {}
) {
  return render(
    <InventorySearchBar
      onOrderChange={() => {}}
      onQChange={() => {}}
      onViewChange={() => {}}
      order="available"
      q=""
      view="card"
      {...overrides}
    />
  );
}

function renderFilters(
  overrides: Partial<Parameters<typeof InventoryFilters>[0]> = {}
) {
  return render(
    <InventoryFilters
      categories={[]}
      onCategoriesChange={() => {}}
      onClear={() => {}}
      onStatusChange={() => {}}
      selectedCategories={[]}
      status={null}
      {...overrides}
    />
  );
}

describe("InventorySearchBar", () => {
  it("debounces search input", async () => {
    vi.useFakeTimers();
    const onQChange = vi.fn();
    const { getByPlaceholderText } = renderSearch({ onQChange });
    fireEvent.change(getByPlaceholderText("Search inventory"), {
      target: { value: "arduino" },
    });
    expect(onQChange).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(310);
    });
    expect(onQChange).toHaveBeenCalledWith("arduino");
    vi.useRealTimers();
  });

  it("does not write a stale draft back when q changes underneath", async () => {
    // Browser Back. The URL's q changes, and the draft holding what the user
    // typed must not be committed over the top of it 300ms later. This bar was
    // the only one of six with no sync-back, so Back undid itself.
    vi.useFakeTimers();
    const onQChange = vi.fn();
    const { getByPlaceholderText, rerender } = renderSearch({
      onQChange,
      q: "old",
    });
    fireEvent.change(getByPlaceholderText("Search inventory"), {
      target: { value: "typed" },
    });

    rerender(
      <InventorySearchBar
        onOrderChange={() => {
          // no-op
        }}
        onQChange={onQChange}
        onViewChange={() => {
          // no-op
        }}
        order="available"
        q="fromBack"
        view="card"
      />
    );
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    expect(onQChange).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("renders the view toggle beside the search", () => {
    const { getByLabelText } = renderSearch();
    expect(getByLabelText("Search inventory")).toBeTruthy();
    expect(getByLabelText("Card view")).toBeTruthy();
    expect(getByLabelText("Table view")).toBeTruthy();
  });

  /**
   * The listing's one ordering since #477. Radix portals the options only
   * once the trigger opens, so these read them through the open menu, as
   * the /projects Sort select's tests do.
   */
  it("offers the three orderings, available first, and shows the current one", () => {
    renderSearch({ order: "name" });
    const trigger = screen.getByRole("combobox", { name: "Sort" });
    expect(trigger.textContent).toBe(INVENTORY_ORDER_LABEL.name);
    fireEvent.click(trigger);
    expect(
      screen.getAllByRole("option").map((option) => option.textContent)
    ).toEqual(["Available first", "Name A-Z", "Recently updated"]);
  });
});

describe("InventoryFilters", () => {
  it("renders the status dropdown, labelled through its Label", () => {
    const { getByLabelText } = renderFilters();
    // Select triggers are labelled via their associated <Label htmlFor>,
    // whose id comes from useId so two mounts do not collide.
    expect(getByLabelText("Status")).toBeTruthy();
  });

  it("offers Clear all only while something narrows, and calls onClear", () => {
    const onClear = vi.fn();
    const { queryByRole, rerender, getByRole } = renderFilters({ onClear });
    expect(queryByRole("button", { name: "Clear all" })).toBeNull();
    rerender(
      <InventoryFilters
        categories={[]}
        onCategoriesChange={() => {}}
        onClear={onClear}
        onStatusChange={() => {}}
        selectedCategories={[]}
        status="available"
      />
    );
    fireEvent.click(getByRole("button", { name: "Clear all" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
