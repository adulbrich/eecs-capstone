// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ViewToggle } from "#/components/view-toggle";
import { readStoredView } from "#/lib/view-preference";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ViewToggle", () => {
  it("persists the chosen view to storage when toggled", () => {
    render(<ViewToggle current="card" onChange={vi.fn()} />);
    screen.getByRole("button", { name: "Table view" }).click();
    expect(readStoredView()).toBe("table");
  });

  it("hands the choice to the route", () => {
    const onChange = vi.fn();
    render(<ViewToggle current="card" onChange={onChange} />);
    screen.getByRole("button", { name: "Table view" }).click();
    expect(onChange).toHaveBeenCalledWith("table");
  });

  it("marks the current mode pressed and ignores a click on it", () => {
    const onChange = vi.fn();
    render(<ViewToggle current="table" onChange={onChange} />);
    const table = screen.getByRole("button", { name: "Table view" });
    expect(table.getAttribute("aria-pressed")).toBe("true");
    table.click();
    expect(onChange).not.toHaveBeenCalled();
  });

  // The other half of the pair. Card view is the default, so it is the one a
  // reader comes back to, and it stores and reports the same way.
  it("switches back to cards, storing and reporting the choice", () => {
    const onChange = vi.fn();
    render(<ViewToggle current="table" onChange={onChange} />);
    screen.getByRole("button", { name: "Card view" }).click();
    expect(readStoredView()).toBe("card");
    expect(onChange).toHaveBeenCalledWith("card");
  });

  it("marks card view pressed when current, and ignores a click on it", () => {
    const onChange = vi.fn();
    render(<ViewToggle current="card" onChange={onChange} />);
    const card = screen.getByRole("button", { name: "Card view" });
    expect(card.getAttribute("aria-pressed")).toBe("true");
    card.click();
    expect(onChange).not.toHaveBeenCalled();
    expect(readStoredView()).toBeNull();
  });
});
