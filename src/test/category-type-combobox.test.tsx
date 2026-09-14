// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CATEGORY_FIELD_DESCRIPTION,
  CategoryTypeCombobox,
} from "#/components/category-type-combobox";

// Radix Popover (Floating UI) and cmdk rely on a few DOM APIs jsdom omits.
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

  it("names the field descriptions with the examples the dialog shows", () => {
    expect(CATEGORY_FIELD_DESCRIPTION.type).toMatch(/Technology, Field/);
    expect(CATEGORY_FIELD_DESCRIPTION.name).toMatch(/React under Technology/);
  });
});
