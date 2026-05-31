// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InventoryStatusBadge } from "#/components/inventory-status-badge";

describe("InventoryStatusBadge", () => {
  it("hides retired by default", () => {
    const { container } = render(<InventoryStatusBadge status="retired" />);
    expect(container.firstChild).toBeNull();
  });
  it("shows retired when showRetired is true", () => {
    const { getByText } = render(
      <InventoryStatusBadge showRetired status="retired" />
    );
    expect(getByText("Retired")).toBeDefined();
  });
  it.each([
    ["available", "Available"],
    ["requested", "Requested"],
    ["reserved", "Reserved"],
    ["checked_out", "Checked out"],
    ["maintenance", "Maintenance"],
  ] as const)("renders %s as %s", (status, label) => {
    const { getByText } = render(<InventoryStatusBadge status={status} />);
    expect(getByText(label)).toBeDefined();
  });
});
