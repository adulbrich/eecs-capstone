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
import { deferred } from "./shared/deferred";

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
  /**
   * The trigger, not the confirm button inside the dialog. It stayed live for
   * the whole batch write and the refetch behind it, offering to reopen a
   * decision over rows the loader had not caught up with (#426).
   */
  /**
   * The regression the disabled trigger nearly introduced. A disabled element
   * cannot hold focus, so when Radix restores focus to the trigger on close it
   * lands on nothing and the user is dropped on `<body>`, with no way back to
   * the row by keyboard. The dialog refuses Escape and outside clicks while the
   * write is in flight, which is what the confirm and cancel buttons already
   * do, so the close and the re-enable can never race.
   *
   * axe cannot see this: it scans a static tree, and this is a transition.
   */
  it.each(["Escape", "close X"])(
    "refuses to close mid-write via %s",
    async (route) => {
      const write = deferred<{ approved: string[] }>();
      vi.mocked(approveRequestLines).mockReturnValue(write.promise as never);
      render(
        <ApproveAllDialog
          lines={lines}
          onDone={() => Promise.resolve()}
          requesterEmail="student@x.edu"
        />
      );
      openDialog();
      fireEvent.click(
        screen.getByRole("button", { name: "Confirm approve all" })
      );
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { hidden: true, name: "Approve all" })
            .hasAttribute("disabled")
        ).toBe(true)
      );

      if (route === "Escape") {
        fireEvent.keyDown(document.activeElement ?? document.body, {
          key: "Escape",
        });
      } else {
        // The route that defeated the first fix: `DialogContent` renders this
        // by default and it goes straight to `onOpenChange`, touching neither
        // `onEscapeKeyDown` nor `onInteractOutside`.
        fireEvent.click(screen.getByRole("button", { name: /close/i }));
      }
      expect(screen.getByRole("dialog")).toBeTruthy();

      write.resolve({ approved: ["a", "b"] });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      // No focus assertion here. Two were tried and neither went red with
      // the guard reverted, so they asserted nothing; the mechanism was
      // not pinned down, and `export-csv-button.test.tsx` is the only
      // place in this repo where a jsdom focus claim has been verified.
      // Nothing covers the browser behaviour today: the accessibility
      // suite scans this page statically and never opens this surface.
    }
  );

  it("disables the Approve all trigger until the write settles", async () => {
    const write = deferred<{ approved: string[] }>();
    vi.mocked(approveRequestLines).mockReturnValue(write.promise as never);
    render(
      <ApproveAllDialog
        lines={lines}
        onDone={() => Promise.resolve()}
        requesterEmail="student@x.edu"
      />
    );

    // `hidden` because this dialog is modal: while it is open the overlay
    // `aria-hidden`s the trigger, so the accessibility tree does not carry it.
    // That is also why the prop matters less here than on the popovers, and
    // where it does matter: a reader who dismisses with Escape mid-write.
    const button = () =>
      screen.getByRole("button", { hidden: true, name: "Approve all" });
    expect(button().hasAttribute("disabled")).toBe(false);

    openDialog();
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm approve all" })
    );
    await waitFor(() => expect(button().hasAttribute("disabled")).toBe(true));

    write.resolve({ approved: ["a", "b"] });
    await waitFor(() => expect(button().hasAttribute("disabled")).toBe(false));
  });

  it("lists only the pending lines it is about to approve", () => {
    render(
      <ApproveAllDialog
        lines={lines}
        onDone={vi.fn()}
        requesterEmail="student@x.edu"
      />
    );
    openDialog();
    const dialog = screen.getByRole("dialog", { name: "Approve 2 lines" });
    expect(dialog.textContent).toContain("Oscilloscope");
    expect(dialog.textContent).toContain("Soldering iron");
    expect(dialog.textContent).not.toContain("Multimeter");
  });

  it("sends exactly the pending ids and the one date, then reports done", async () => {
    vi.mocked(approveRequestLines).mockResolvedValue({ approved: ["a", "b"] });
    const onDone = vi.fn();
    render(
      <ApproveAllDialog
        lines={lines}
        onDone={onDone}
        requesterEmail="student@x.edu"
      />
    );
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
        sendEmail: true,
      },
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the server's refusal inside the dialog and stays open", async () => {
    vi.mocked(approveRequestLines).mockRejectedValue(
      new Error("Oscilloscope is no longer pending")
    );
    const onDone = vi.fn();
    render(
      <ApproveAllDialog
        lines={lines}
        onDone={onDone}
        requesterEmail="student@x.edu"
      />
    );
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
    render(
      <ApproveAllDialog
        lines={lines}
        onDone={vi.fn()}
        requesterEmail="student@x.edu"
      />
    );
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(approveRequestLines).not.toHaveBeenCalled();
  });

  it("forgets the server's refusal when cancelled and reopened", async () => {
    vi.mocked(approveRequestLines).mockRejectedValue(
      new Error("Oscilloscope is no longer pending")
    );
    render(
      <ApproveAllDialog
        lines={lines}
        onDone={vi.fn()}
        requesterEmail="student@x.edu"
      />
    );
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
        requesterEmail="student@x.edu"
      />
    );
    expect(screen.queryByRole("button", { name: "Approve all" })).toBeNull();
  });

  it("carries the skip for the whole batch, and checks the box again after a Cancel (#387)", async () => {
    vi.mocked(approveRequestLines).mockResolvedValue({ approved: ["a", "b"] });
    const onDone = vi.fn();
    render(
      <ApproveAllDialog
        lines={lines}
        onDone={onDone}
        requesterEmail="student@x.edu"
      />
    );
    openDialog();
    const box = screen.getByRole("checkbox", { name: "Email student@x.edu" });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    openDialog();
    const again = screen.getByRole("checkbox", { name: "Email student@x.edu" });
    expect(again.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(again);
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm approve all" })
    );
    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(approveRequestLines).toHaveBeenCalledWith({
      data: { requestItemIds: ["b", "a"], pickupBy: null, sendEmail: false },
    });
  });
});
