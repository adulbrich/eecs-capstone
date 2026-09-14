// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CategoryTypeCombobox } from "#/components/category-type-combobox";
import { installResizeObserver } from "./radix-jsdom";

// Radix Popover (Floating UI) and cmdk rely on a few DOM APIs jsdom omits.
beforeAll(() => {
  installResizeObserver();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

const TYPES = ["Field", "Industry", "Technology"];

function open(types = TYPES) {
  const onChange = vi.fn();
  render(<CategoryTypeCombobox onChange={onChange} types={types} value="" />);
  fireEvent.click(screen.getByRole("combobox"));
  return onChange;
}

describe("CategoryTypeCombobox", () => {
  it("lists the matching types before the Create row, which names a type", async () => {
    open();
    fireEvent.change(screen.getByPlaceholderText("Search or add a type"), {
      target: { value: "Tech" },
    });
    const options = await screen.findAllByRole("option");
    const labels = options.map((o) => o.textContent);
    expect(labels.at(-1)).toBe('Create type "Tech"');
    expect(labels.indexOf("Technology")).toBeLessThan(
      labels.indexOf('Create type "Tech"')
    );
  });

  it("offers no Create row for a query that names an existing type", async () => {
    open();
    fireEvent.change(screen.getByPlaceholderText("Search or add a type"), {
      target: { value: "technology" },
    });
    await screen.findByRole("option", { name: "Technology" });
    expect(screen.queryByText(/^Create type/)).toBeNull();
  });

  it("selects the typed value from the Create row", async () => {
    const onChange = open();
    fireEvent.change(screen.getByPlaceholderText("Search or add a type"), {
      target: { value: "Domain" },
    });
    fireEvent.click(await screen.findByText('Create type "Domain"'));
    expect(onChange).toHaveBeenCalledWith("Domain");
  });
});
