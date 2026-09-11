// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatusBadge } from "#/components/status-badge";

describe("StatusBadge", () => {
  it.each([
    ["draft", "Draft"],
    ["submitted", "Submitted"],
    ["changes_requested", "Changes requested"],
    ["approved", "Approved"],
    ["published", "Published"],
    ["archived", "Archived"],
  ] as const)("renders %s as %s", (status, label) => {
    const { getByText } = render(<StatusBadge status={status} />);
    expect(getByText(label)).toBeDefined();
  });

  it("falls back to the raw value for a status the vocabulary does not have", () => {
    // Callers hand over the wire's string; a value the enum lacks still
    // renders something rather than an empty badge.
    const { getByText } = render(<StatusBadge status="on_hold" />);
    expect(getByText("on hold")).toBeDefined();
  });
});
