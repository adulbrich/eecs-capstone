// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  InventoryFilters,
  InventorySearchBar,
} from "#/components/inventory-filters";

afterEach(cleanup);

function renderSearch(
  overrides: Partial<Parameters<typeof InventorySearchBar>[0]> = {}
) {
  return render(
    <InventorySearchBar
      onQChange={() => {}}
      onViewChange={() => {}}
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
        onQChange={onQChange}
        onViewChange={() => {
          // no-op
        }}
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
});

describe("InventoryFilters", () => {
  it("renders the status dropdown, labelled through its Label", () => {
    const { getByLabelText } = renderFilters();
    // Select triggers are labelled via their associated <Label htmlFor>,
    // whose id comes from useId so two mounts do not collide.
    expect(getByLabelText("Status")).toBeTruthy();
  });

  it("renders a checkbox per category, checked according to selection", () => {
    const categories = [
      { id: "11111111-1111-4111-8111-111111111111", name: "Cameras" },
      { id: "22222222-2222-4222-8222-222222222222", name: "Drills" },
    ];
    const { getByLabelText } = renderFilters({
      categories,
      selectedCategories: [categories[0].id],
    });
    expect(getByLabelText("Cameras").getAttribute("aria-checked")).toBe("true");
    expect(getByLabelText("Drills").getAttribute("aria-checked")).toBe("false");
  });

  it("toggles a category on and off via onCategoriesChange", () => {
    const categories = [
      { id: "11111111-1111-4111-8111-111111111111", name: "Cameras" },
      { id: "22222222-2222-4222-8222-222222222222", name: "Drills" },
    ];
    const onCategoriesChange = vi.fn();
    const { getByLabelText } = renderFilters({
      categories,
      onCategoriesChange,
      selectedCategories: [categories[0].id],
    });
    fireEvent.click(getByLabelText("Drills"));
    expect(onCategoriesChange).toHaveBeenCalledWith([
      categories[0].id,
      categories[1].id,
    ]);
    fireEvent.click(getByLabelText("Cameras"));
    expect(onCategoriesChange).toHaveBeenCalledWith([]);
  });
});
