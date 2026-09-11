// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusBadge } from "#/components/status-badge";

afterEach(cleanup);

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

  it("explains the status in a tooltip", () => {
    const { getByText } = render(<StatusBadge status="approved" />);
    expect(getByText("Approved").getAttribute("title")).toBe(
      "Accepted by staff and not yet published. Only the proposer and staff can see it."
    );
  });

  it("falls back to the raw value for a status the vocabulary does not have", () => {
    // Callers hand over the wire's string; a value the enum lacks still
    // renders something rather than an empty badge.
    const { getByText } = render(<StatusBadge status="on_hold" />);
    expect(getByText("on hold")).toBeDefined();
    expect(getByText("on hold").getAttribute("title")).toBeNull();
  });
});
