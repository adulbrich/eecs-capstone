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
});
