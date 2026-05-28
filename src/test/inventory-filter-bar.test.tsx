// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InventoryFilterBar } from "#/components/inventory-filter-bar";

afterEach(cleanup);

function renderBar(
  overrides: Partial<Parameters<typeof InventoryFilterBar>[0]> = {},
) {
  return render(
    <InventoryFilterBar
      q=""
      status={null}
      category={null}
      view="card"
      categories={[]}
      onQChange={() => {}}
      onStatusChange={() => {}}
      onCategoryChange={() => {}}
      onViewChange={() => {}}
      {...overrides}
    />,
  );
}

describe("InventoryFilterBar", () => {
  it("debounces search input", async () => {
    vi.useFakeTimers();
    const onQChange = vi.fn();
    const { getByPlaceholderText } = renderBar({ onQChange });
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

  it("renders category and status dropdowns and the view toggle", () => {
    const { getByLabelText } = renderBar();
    // Select triggers are labelled via their associated <Label htmlFor>.
    expect(getByLabelText("Category")).toBeTruthy();
    expect(getByLabelText("Status")).toBeTruthy();
    expect(getByLabelText("Card view")).toBeTruthy();
    expect(getByLabelText("Row view")).toBeTruthy();
  });
});
