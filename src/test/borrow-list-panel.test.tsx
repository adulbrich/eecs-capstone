// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    ...rest
  }: { children: React.ReactNode; to: string } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { BorrowListPanel } from "#/components/borrow-list-panel";

afterEach(cleanup);

const rows = [
  { itemId: "i1", name: "Oscilloscope", status: "available" },
  { itemId: "i2", name: "Raspberry Pi 5", status: "available" },
];

describe("BorrowListPanel", () => {
  it("explains the flow and points at the inventory when the list is empty", () => {
    render(
      <BorrowListPanel
        busy={false}
        onRemove={vi.fn()}
        onSubmit={vi.fn()}
        rows={[]}
      />
    );
    expect(screen.getByText(/borrow list is empty/i)).toBeDefined();
    expect(
      screen.getByRole("link", { name: /inventory/i }).getAttribute("href")
    ).toBe("/inventory");
    expect(screen.queryByRole("button", { name: "Submit request" })).toBeNull();
  });

  it("reads as one request: the rows, the note and the submit sit in one region", () => {
    render(
      <BorrowListPanel
        busy={false}
        onRemove={vi.fn()}
        onSubmit={vi.fn()}
        rows={rows}
      />
    );
    const region = screen.getByRole("region", {
      name: /Request being assembled/,
    });
    expect(region.textContent).toContain("Oscilloscope");
    expect(region.textContent).toContain("Raspberry Pi 5");
    expect(screen.getByLabelText("Note for staff (optional)")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Submit request" })
    ).toBeDefined();
  });

  it("removes a row by id and submits the note for the whole request", () => {
    const onRemove = vi.fn();
    const onSubmit = vi.fn();
    render(
      <BorrowListPanel
        busy={false}
        onRemove={onRemove}
        onSubmit={onSubmit}
        rows={rows}
      />
    );
    fireEvent.click(screen.getAllByRole("button", { name: "Remove" })[1]!);
    expect(onRemove).toHaveBeenCalledWith("i2");
    fireEvent.change(screen.getByLabelText("Note for staff (optional)"), {
      target: { value: "For the capstone demo" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    expect(onSubmit).toHaveBeenCalledWith("For the capstone demo");
  });
});
