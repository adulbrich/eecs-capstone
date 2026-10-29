// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExpectedBack } from "#/components/expected-back";

afterEach(cleanup);

// The end of March 1 in Corvallis, which is already March 2 in UTC.
const DUE = new Date("2026-03-02T07:59:59.999Z");

describe("ExpectedBack", () => {
  it("says when a checked-out item is expected back", () => {
    render(<ExpectedBack dueAt={DUE} status="checked_out" />);
    // The office's day on the first render, with no effect to wait for (#805).
    expect(
      screen.getByText(/Expected back on/u).textContent?.replace(/\s+/gu, " ")
    ).toBe("Expected back on Mar 1, 2026.");
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
    expect(screen.getByText(/Expected back on/u)).toBeDefined();
    expect(document.body.textContent).not.toMatch(/overdue/iu);
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
