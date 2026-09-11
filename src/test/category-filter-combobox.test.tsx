// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CategoryFilterCombobox } from "#/components/category-filter-combobox";
import { installResizeObserver } from "./radix-jsdom";

// Radix Popover (Floating UI) and cmdk rely on a few DOM APIs jsdom omits.
// Same stub set as category-multi-select.test.tsx.
beforeAll(() => {
  installResizeObserver();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

const CATEGORIES = [
  { id: "c1", name: "Laptop" },
  { id: "c2", name: "Monitor" },
];

// The combobox does not own `value`; the listing route feeds onChange back
// through its search params. A useState stand-in does the same here.
function Controlled({ onChange }: { onChange?: (next: string[]) => void }) {
  const [value, setValue] = useState<string[]>([]);
  return (
    <CategoryFilterCombobox
      categories={CATEGORIES}
      onChange={(next) => {
        setValue(next);
        onChange?.(next);
      }}
      value={value}
    />
  );
}

// Read before the list opens: cmdk's search input carries the combobox role
// too, so the role alone is ambiguous once the popover is up.
const trigger = () => screen.getByRole("combobox");

describe("CategoryFilterCombobox", () => {
  it("opens the list from the trigger and says so", () => {
    render(<Controlled />);
    const button = trigger();
    expect(button.textContent).toContain("All categories");
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByPlaceholderText("Search categories...")).toBeNull();

    fireEvent.click(button);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByPlaceholderText("Search categories...")).toBeTruthy();
    expect(screen.getByText("Laptop")).toBeTruthy();
    expect(screen.getByText("Monitor")).toBeTruthy();
  });

  it("toggles membership on each pick and stays open for the next one", () => {
    const onChange = vi.fn();
    render(<Controlled onChange={onChange} />);
    const button = trigger();
    fireEvent.click(button);

    fireEvent.click(screen.getByText("Laptop"));
    expect(onChange).toHaveBeenLastCalledWith(["c1"]);
    expect(button.textContent).toContain("Laptop");
    // Every selected id is required by the listing, so a second pick narrows
    // rather than replaces, and the list has to stay open to make it.
    expect(screen.getByPlaceholderText("Search categories...")).toBeTruthy();

    fireEvent.click(screen.getByText("Monitor"));
    expect(onChange).toHaveBeenLastCalledWith(["c1", "c2"]);
    expect(button.textContent).toContain("2 categories selected");

    fireEvent.click(screen.getByText("Laptop"));
    expect(onChange).toHaveBeenLastCalledWith(["c2"]);
    expect(button.textContent).toContain("Monitor");
  });
});
