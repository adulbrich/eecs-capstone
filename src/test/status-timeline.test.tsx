// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StatusTimeline } from "#/components/status-timeline";

afterEach(cleanup);

type Row = Parameters<typeof StatusTimeline>[0]["rows"][number];

function row(overrides: Partial<Row> = {}): Row {
  return {
    id: "h1",
    oldStatus: "submitted",
    newStatus: "changes_requested",
    changedByName: "Ada Lovelace",
    comment: null,
    createdAt: "2026-05-28T10:00:00.000Z",
    ...overrides,
  };
}

describe("StatusTimeline", () => {
  it("names the actor beside the timestamp", () => {
    render(<StatusTimeline rows={[row()]} />);
    expect(screen.getByText("by Ada Lovelace")).toBeTruthy();
  });

  it("reads a deleted account as the name ADR 0008 scrubbed it to", () => {
    // The row outlives the account: `changed_by` is `onDelete: "restrict"`, so
    // deletion sets the name to "Deleted user" rather than removing the audit
    // row. This is the same branch as the case above with the data a scrubbed
    // account leaves behind, which is the only shape a missing actor can take.
    render(<StatusTimeline rows={[row({ changedByName: "Deleted user" })]} />);
    expect(screen.getByText("by Deleted user")).toBeTruthy();
    expect(screen.queryByText(/@/)).toBeNull();
  });

  it("says so when there is no history", () => {
    render(<StatusTimeline rows={[]} />);
    expect(screen.getByText("No status changes yet.")).toBeTruthy();
  });

  it("still calls the first row created, and names its actor too", () => {
    render(<StatusTimeline rows={[row({ oldStatus: null })]} />);
    expect(screen.getByText("created")).toBeTruthy();
    expect(screen.getByText("by Ada Lovelace")).toBeTruthy();
  });

  it("keeps the comment under the row", () => {
    render(<StatusTimeline rows={[row({ comment: "Tighten the scope." })]} />);
    expect(screen.getByText("Tighten the scope.")).toBeTruthy();
  });
});
