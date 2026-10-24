// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AdminRequestActions } from "#/components/admin-request-actions";
import { rejectRequestItem } from "#/server/inventory";
import { installResizeObserver } from "./radix-jsdom";
import { deferred } from "./shared/deferred";

vi.mock("#/server/inventory", () => ({
  approveRequestItem: vi.fn(),
  approveRequestLines: vi.fn(),
  rejectRequestItem: vi.fn(),
}));

// The popover positions itself through Floating UI, which measures, and the
// approve dialog reads the pointer-capture APIs jsdom omits.
beforeAll(() => {
  installResizeObserver();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderLine(status = "pending") {
  render(
    <AdminRequestActions
      itemLocation="Cabinet A, Bin 1"
      itemName="Oscilloscope"
      lineId="line-1"
      onDone={() => Promise.resolve()}
      requesterEmail="student@x.edu"
      requesterName="Jordan Lee"
      status={status}
    />
  );
}

function startReject(reason = "Out of stock") {
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  fireEvent.change(screen.getByLabelText("Reason (sent to requester)"), {
    target: { value: reason },
  });
}

describe("AdminRequestActions", () => {
  /**
   * A popover restores focus to its trigger on close just as a dialog does,
   * and the trigger is `disabled` while busy, so dismissing mid-write stranded
   * the reader on `<body>` (#426). The guard sits in `dismiss()`, which Escape
   * and an outside click both reach. Cancel does not: it calls `close()`
   * directly and is held off by `disabled={busy}` instead.
   */
  it("refuses to close the reject popover mid-write", async () => {
    const write = deferred<void>();
    vi.mocked(rejectRequestItem).mockReturnValue(write.promise as never);
    renderLine();

    startReject();
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Reject" }).hasAttribute("disabled")
      ).toBe(true)
    );

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.getByLabelText("Reason (sent to requester)")).toBeTruthy();

    write.resolve();
    await waitFor(() =>
      expect(screen.queryByLabelText("Reason (sent to requester)")).toBeNull()
    );
  });

  /**
   * Both triggers, not the confirm button. They stayed live for the whole
   * write and the refetch behind it, offering to reopen a decision over a row
   * the loader had not caught up with (#426). Approve lives in its own dialog
   * now, so the row holds it off through the dialog's `disabled` prop.
   */
  it.each(["Approve", "Reject"])(
    "holds the %s trigger off while a rejection writes",
    async (trigger) => {
      const write = deferred<void>();
      vi.mocked(rejectRequestItem).mockReturnValue(write.promise as never);
      renderLine();

      const button = () => screen.getByRole("button", { name: trigger });
      expect(button().hasAttribute("disabled")).toBe(false);

      startReject();
      fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
      await waitFor(() => expect(button().hasAttribute("disabled")).toBe(true));

      write.resolve();
      await waitFor(() =>
        expect(button().hasAttribute("disabled")).toBe(false)
      );
    }
  );

  /**
   * Two activations inside one tick, which is the case `disabled` cannot
   * cover: the prop only stops the second click once React has re-rendered
   * (#443). The same shape as "refuses a second call while the first is still
   * in flight" in `use-action.test.tsx`.
   */
  it("refuses a second reject that arrives inside one tick", async () => {
    const write = deferred<void>();
    vi.mocked(rejectRequestItem).mockReturnValue(write.promise as never);
    renderLine();
    startReject();
    const confirm = screen.getByRole("button", { name: "Confirm reject" });

    // Not two `fireEvent.click` calls: those flush between, so the second
    // lands on a button React has already disabled and the test passes with
    // or without a guard.
    await act(() => {
      confirm.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      confirm.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      return Promise.resolve();
    });

    expect(rejectRequestItem).toHaveBeenCalledTimes(1);
    write.resolve();
    await waitFor(() =>
      expect(screen.queryByLabelText("Reason (sent to requester)")).toBeNull()
    );
  });

  it("offers Approve and Reject for a pending line", () => {
    renderLine();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reject" })).toBeTruthy();
  });

  it("offers nothing once the line has been decided", () => {
    // Approving or rejecting is a one-way door: the queue must not offer a
    // second decision on a line that already has one.
    renderLine("approved");
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reject" })).toBeNull();
  });

  /**
   * The pickup terms are a form, so a line opens the same dialog as a whole
   * request (#799), named for the item and the requester and with the item's
   * location copied in. `approve-dialog.test.tsx` covers the dialog itself.
   */
  it("opens the approve dialog for this line, with its location copied in", () => {
    renderLine();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(
      screen.getByRole("dialog", {
        name: "Approve Oscilloscope for Jordan Lee",
      })
    ).toBeTruthy();
    expect(
      (screen.getByLabelText("Where to pick up (optional)") as HTMLInputElement)
        .value
    ).toBe("Cabinet A, Bin 1");
  });

  it("closes the reject popover on Cancel without deciding", async () => {
    renderLine();
    startReject("Not stocked");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Reason (sent to requester)")).toBeNull()
    );
    expect(rejectRequestItem).not.toHaveBeenCalled();
  });

  it("names the requester on the reject popover and sends the skip with the decision (#387)", async () => {
    vi.mocked(rejectRequestItem).mockResolvedValue({ ok: true });
    renderLine();

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const box = await screen.findByRole("checkbox", {
      name: "Email student@x.edu",
    });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText(
        "Uncheck to skip the email; the in-app notification is still sent."
      )
    ).toBeTruthy();
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText("Reason (sent to requester)"), {
      target: { value: "Out of scope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    await waitFor(() =>
      expect(rejectRequestItem).toHaveBeenCalledWith({
        data: {
          requestItemId: "line-1",
          reviewComment: "Out of scope",
          sendEmail: false,
        },
      })
    );
  });
});
