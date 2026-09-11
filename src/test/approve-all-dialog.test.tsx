// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ApproveAllDialog } from "#/components/approve-all-dialog";
import { approveRequestLines } from "#/server/inventory";

vi.mock("#/server/inventory", () => ({
  approveRequestLines: vi.fn(),
}));

// Radix Dialog reads a few DOM APIs jsdom omits. Same stub set as
// admin-data-table.test.tsx.
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {
      // no-op
    }
    unobserve() {
      // no-op
    }
    disconnect() {
      // no-op
    }
  };
});

afterEach(() => {
  cleanup();
  vi.mocked(approveRequestLines).mockReset();
});

const lines = [
  { id: "b", itemName: "Oscilloscope", status: "pending" },
  { id: "a", itemName: "Soldering iron", status: "pending" },
  { id: "c", itemName: "Multimeter", status: "rejected" },
];

function openDialog() {
  fireEvent.click(screen.getByRole("button", { name: "Approve all" }));
}

describe("ApproveAllDialog", () => {
  it("lists only the pending lines it is about to approve", () => {
    render(<ApproveAllDialog lines={lines} onDone={vi.fn()} />);
    openDialog();
    const dialog = screen.getByRole("dialog", { name: "Approve 2 lines" });
    expect(dialog.textContent).toContain("Oscilloscope");
    expect(dialog.textContent).toContain("Soldering iron");
    expect(dialog.textContent).not.toContain("Multimeter");
  });

  it("sends exactly the pending ids and the one date, then reports done", async () => {
    vi.mocked(approveRequestLines).mockResolvedValue({ approved: ["a", "b"] });
    const onDone = vi.fn();
    render(<ApproveAllDialog lines={lines} onDone={onDone} />);
    openDialog();
    fireEvent.change(screen.getByLabelText("Pickup by (optional)"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm approve all" })
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(approveRequestLines).toHaveBeenCalledWith({
      data: {
        requestItemIds: ["b", "a"],
        pickupBy: new Date("2026-10-01"),
      },
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the server's refusal inside the dialog and stays open", async () => {
    vi.mocked(approveRequestLines).mockRejectedValue(
      new Error("Oscilloscope is no longer pending")
    );
    const onDone = vi.fn();
    render(<ApproveAllDialog lines={lines} onDone={onDone} />);
    openDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm approve all" })
    );

    await waitFor(() =>
      expect(
        screen.getByText("Oscilloscope is no longer pending")
      ).toBeDefined()
    );
    expect(screen.getByRole("dialog")).toBeDefined();
    expect(onDone).not.toHaveBeenCalled();
  });

  it("closes on Cancel without approving anything", async () => {
    render(<ApproveAllDialog lines={lines} onDone={vi.fn()} />);
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(approveRequestLines).not.toHaveBeenCalled();
  });

  it("forgets the server's refusal when cancelled and reopened", async () => {
    vi.mocked(approveRequestLines).mockRejectedValue(
      new Error("Oscilloscope is no longer pending")
    );
    render(<ApproveAllDialog lines={lines} onDone={vi.fn()} />);
    openDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm approve all" })
    );
    await waitFor(() =>
      expect(
        screen.getByText("Oscilloscope is no longer pending")
      ).toBeDefined()
    );

    // The refusal was about the attempt, not the lines; a fresh opening
    // starts clean rather than showing a stale reason.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    openDialog();
    expect(screen.queryByText("Oscilloscope is no longer pending")).toBeNull();
  });

  it("renders nothing when every line is decided", () => {
    render(
      <ApproveAllDialog
        lines={[{ id: "c", itemName: "Multimeter", status: "approved" }]}
        onDone={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: "Approve all" })).toBeNull();
  });
});
