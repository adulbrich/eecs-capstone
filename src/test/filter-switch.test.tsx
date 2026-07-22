// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilterSwitch } from "#/components/filter-switch";

afterEach(cleanup);

describe("FilterSwitch", () => {
  it("exposes an accessible name taken from its label", () => {
    render(
      <FilterSwitch
        checked={false}
        id="archived-only"
        label="Show only archived projects"
        onCheckedChange={() => {
          // no-op
        }}
      />
    );
    const control = screen.getByRole("switch", {
      name: "Show only archived projects",
    });
    expect(control).toBeTruthy();
  });

  it("reports its checked state", () => {
    render(
      <FilterSwitch
        checked
        id="archived-only"
        label="Show only archived projects"
        onCheckedChange={() => {
          // no-op
        }}
      />
    );
    expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe(
      "true"
    );
  });

  it("calls onCheckedChange with the next value when toggled", () => {
    const onCheckedChange = vi.fn();
    render(
      <FilterSwitch
        checked={false}
        id="archived-only"
        label="Show only archived projects"
        onCheckedChange={onCheckedChange}
      />
    );
    screen.getByRole("switch").click();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("aligns to the control row height, not the label row", () => {
    const { container } = render(
      <FilterSwitch
        checked={false}
        id="archived-only"
        label="Show only archived projects"
        onCheckedChange={() => {
          // no-op
        }}
      />
    );
    expect(container.firstElementChild?.className).toContain("h-9");
  });
});
