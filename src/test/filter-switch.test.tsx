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
        label="Only show archived projects"
        onCheckedChange={() => {
          // no-op
        }}
      />
    );
    const control = screen.getByRole("switch", {
      name: "Only show archived projects",
    });
    expect(control).toBeTruthy();
  });

  it("reports its checked state", () => {
    render(
      <FilterSwitch
        checked
        id="archived-only"
        label="Only show archived projects"
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
        label="Only show archived projects"
        onCheckedChange={onCheckedChange}
      />
    );
    screen.getByRole("switch").click();
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("disables the control when a filter above it rules this one out", () => {
    const onCheckedChange = vi.fn();
    render(
      <FilterSwitch
        checked={false}
        disabled
        id="archived-only"
        label="Only show archived projects"
        onCheckedChange={onCheckedChange}
      />
    );
    const control = screen.getByRole("switch");
    expect(control.hasAttribute("disabled")).toBe(true);
    control.click();
    expect(onCheckedChange).not.toHaveBeenCalled();
  });

  it("describes the switch by its hint, and only then grows past the control row", () => {
    // The hint is the switch's accessible description (#383), the way the
    // search hint is the input's.
    render(
      <FilterSwitch
        checked={false}
        hint="Hides projects whose team is already full."
        id="accepting-only"
        label="are accepting applicants"
        onCheckedChange={() => {
          // no-op
        }}
      />
    );
    const control = screen.getByRole("switch", {
      name: "are accepting applicants",
    });
    expect(control.getAttribute("aria-describedby")).toBe(
      "accepting-only-hint"
    );
    expect(document.getElementById("accepting-only-hint")?.textContent).toBe(
      "Hides projects whose team is already full."
    );
    expect(control.parentElement?.className).toContain("min-h-9");
  });

  it("aligns to the control row height, not the label row", () => {
    const { container } = render(
      <FilterSwitch
        checked={false}
        id="archived-only"
        label="Only show archived projects"
        onCheckedChange={() => {
          // no-op
        }}
      />
    );
    expect(container.firstElementChild?.className).toContain("h-9");
  });
});
