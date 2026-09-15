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
    changedByEmail: "ada@oregonstate.edu",
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

  it("falls back to the address when the name is missing", () => {
    render(<StatusTimeline rows={[row({ changedByName: null })]} />);
    expect(screen.getByText("by ada@oregonstate.edu")).toBeTruthy();
  });

  it("reads a deleted account as its scrubbed name, never as an address", () => {
    // ADR 0008 sets the name to "Deleted user" and the address to
    // deleted-<id>@invalid rather than removing the row, so the fallback above
    // cannot print a real address for someone who has left.
    render(
      <StatusTimeline
        rows={[
          row({
            changedByName: "Deleted user",
            changedByEmail: "deleted-abc123@invalid",
          }),
        ]}
      />
    );
    expect(screen.getByText("by Deleted user")).toBeTruthy();
    expect(screen.queryByText(/@invalid/)).toBeNull();
  });

  it("says so when there is no history, and names nobody", () => {
    render(<StatusTimeline rows={[]} />);
    expect(screen.getByText("No status changes yet.")).toBeTruthy();
    expect(screen.queryByText(/^by /)).toBeNull();
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
