// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExpectedBack } from "#/components/expected-back";

afterEach(cleanup);

const DUE = new Date("2026-03-01T00:00:00Z");

describe("ExpectedBack", () => {
  it("says when a checked-out item is expected back", () => {
    render(<ExpectedBack dueAt={DUE} status="checked_out" />);
    expect(screen.getByText(/Expected back on/)).toBeDefined();
    // A `<time datetime>` rather than prose, the shape every other date on
    // the site renders through.
    expect(document.querySelector("time")?.getAttribute("dateTime")).toBe(
      DUE.toISOString()
    );
  });

  it("says the same for a date already past, never overdue", () => {
    // Overdue is a staff concern; naming it publicly points at the holder.
    render(
      <ExpectedBack
        dueAt={new Date("2020-01-01T00:00:00Z")}
        status="reserved"
      />
    );
    expect(screen.getByText(/Expected back on/)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/overdue/i);
  });

  it("renders nothing for an available item, even with a stale date", () => {
    const { container } = render(
      <ExpectedBack dueAt={DUE} status="available" />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when no date is set", () => {
    const { container } = render(
      <ExpectedBack dueAt={null} status="checked_out" />
    );
    expect(container.innerHTML).toBe("");
  });
});
