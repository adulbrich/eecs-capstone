// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { OverdueBadge } from "#/components/overdue-badge";
import type { DeadlineEntry } from "#/lib/inventory-deadlines";

afterEach(cleanup);

const PAST = new Date(Date.now() - 86_400_000);
const FUTURE = new Date(Date.now() + 86_400_000);

function hold(
  status: string,
  pickupBy: Date | null,
  dueAt: Date | null
): DeadlineEntry {
  return {
    kind: "hold",
    item: {
      status,
      pickupBy,
      dueAt,
      updatedAt: new Date(),
    },
  };
}

describe("OverdueBadge", () => {
  it("says Overdue for a checked-out item past its due date", () => {
    const { getByText } = render(
      <OverdueBadge entry={hold("checked_out", null, PAST)} />
    );
    expect(getByText("Overdue")).toBeTruthy();
  });

  it("says Pickup overdue for a reserved item past its window", () => {
    // A different ask: collect this, rather than bring it back.
    const { getByText } = render(
      <OverdueBadge entry={hold("reserved", PAST, null)} />
    );
    expect(getByText("Pickup overdue")).toBeTruthy();
  });

  it("renders nothing when the deadline has not passed", () => {
    const { container } = render(
      <OverdueBadge entry={hold("checked_out", null, FUTURE)} />
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing when there is no deadline", () => {
    const { container } = render(
      <OverdueBadge entry={hold("reserved", null, null)} />
    );
    expect(container.textContent).toBe("");
  });

  it("reads a request entry's dates off the line", () => {
    const entry: DeadlineEntry = {
      kind: "request",
      itemStatus: "checked_out",
      line: { pickupBy: null, dueAt: PAST, createdAt: new Date() },
    };
    expect(
      render(<OverdueBadge entry={entry} />).getByText("Overdue")
    ).toBeTruthy();
  });
});
