// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    search?: Record<string, string>;
  } & Record<string, unknown>) => (
    <a href={`${to}?tab=${search?.tab ?? ""}`} {...rest}>
      {children}
    </a>
  ),
}));

import { NeedsAttention } from "#/components/my-items-attention";
import type { DeadlineEntry } from "#/lib/inventory-deadlines";

afterEach(cleanup);

const now = new Date("2026-09-03T12:00:00Z");
const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);
const hold = (status: string, dueAt: Date | null, pickupBy: Date | null) =>
  ({
    kind: "hold" as const,
    item: { status, dueAt, pickupBy, updatedAt: now },
  }) satisfies DeadlineEntry;

describe("NeedsAttention", () => {
  it("renders nothing when the account has nothing active", () => {
    const { container } = render(<NeedsAttention entries={[]} now={now} />);
    expect(container.innerHTML).toBe("");
  });

  it("says so quietly when everything active is in order", () => {
    render(
      <NeedsAttention
        entries={[hold("checked_out", day(20), null)]}
        now={now}
      />
    );
    expect(screen.getByText(/Nothing needs your attention/)).toBeDefined();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("opens the page by answering what is wrong, with a link into Active", () => {
    render(
      <NeedsAttention
        entries={[
          hold("checked_out", day(-2), null),
          hold("checked_out", day(-5), null),
          hold("reserved", null, day(-1)),
          hold("checked_out", day(2), null),
        ]}
        now={now}
      />
    );
    const region = screen.getByRole("region", { name: "Needs your attention" });
    expect(region.textContent).toContain("2 items overdue for return");
    expect(region.textContent).toContain("1 pickup overdue");
    expect(region.textContent).toContain("1 return due within 3 days");
    expect(
      screen.getByRole("link", { name: /Active/ }).getAttribute("href")
    ).toBe("/my/items?tab=active");
  });
});
