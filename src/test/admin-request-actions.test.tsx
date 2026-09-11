// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminRequestActions } from "#/components/admin-request-actions";
import { approveRequestItem, rejectRequestItem } from "#/server/inventory";
import { installResizeObserver } from "./radix-jsdom";

vi.mock("#/server/inventory", () => ({
  approveRequestItem: vi.fn(),
  rejectRequestItem: vi.fn(),
}));

// The popovers position themselves through Floating UI, which measures.
beforeAll(installResizeObserver);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderPending() {
  render(
    <AdminRequestActions
      lineId="line-1"
      onDone={() => undefined}
      status="pending"
    />
  );
}

describe("AdminRequestActions", () => {
  it("offers Approve and Reject for a pending line", () => {
    renderPending();

    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("offers nothing once the line has been decided", () => {
    // Approving or rejecting is a one-way door: the queue must not offer a
    // second decision on a line that already has one.
    render(
      <AdminRequestActions
        lineId="line-1"
        onDone={() => undefined}
        status="approved"
      />
    );

    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  it("closes the approve popover on Cancel without deciding", async () => {
    renderPending();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.change(screen.getByLabelText("Pickup by (optional)"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Pickup by (optional)")).toBeNull()
    );
    expect(approveRequestItem).not.toHaveBeenCalled();
  });

  it("closes the reject popover on Cancel without deciding", async () => {
    renderPending();
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText("Reason (sent to requester)"), {
      target: { value: "Not stocked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Reason (sent to requester)")).toBeNull()
    );
    expect(rejectRequestItem).not.toHaveBeenCalled();
  });
});
