// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => navigate,
}));

import { ViewToggle } from "#/components/view-toggle";
import { readStoredView } from "#/lib/view-preference";

afterEach(() => {
  cleanup();
  localStorage.clear();
  navigate.mockReset();
});

describe("ViewToggle", () => {
  it("persists the chosen view to storage when toggled", () => {
    render(<ViewToggle current="card" />);
    screen.getByRole("button", { name: "Table view" }).click();
    expect(readStoredView()).toBe("table");
  });

  it("writes the choice into the URL", () => {
    render(<ViewToggle current="card" />);
    screen.getByRole("button", { name: "Table view" }).click();
    expect(navigate).toHaveBeenCalledTimes(1);
    const [{ search }] = navigate.mock.calls[0] as [
      { search: (prev: Record<string, unknown>) => Record<string, unknown> },
    ];
    expect(search({ q: "rover" })).toEqual({ q: "rover", view: "table" });
  });

  it("marks the current mode pressed and ignores a click on it", () => {
    render(<ViewToggle current="table" />);
    const table = screen.getByRole("button", { name: "Table view" });
    expect(table.getAttribute("aria-pressed")).toBe("true");
    table.click();
    expect(navigate).not.toHaveBeenCalled();
  });
});
