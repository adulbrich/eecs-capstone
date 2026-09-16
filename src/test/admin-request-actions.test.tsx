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
import { deferred } from "./shared/deferred";

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
      onDone={() => Promise.resolve()}
      requesterEmail="student@x.edu"
      status="pending"
    />
  );
}

describe("AdminRequestActions", () => {
  /**
   * A popover restores focus to its trigger on close just as a dialog does,
   * and the trigger is `disabled` while busy, so dismissing mid-write stranded
   * the reader on `<body>` here too (#426). The guard sits in `dismiss()`,
   * which Escape and an outside click both reach. Cancel does not: it calls
   * `close()` directly and is held off by `disabled={busy}` instead.
   */
  it("refuses to close mid-write", async () => {
    const write = deferred<void>();
    vi.mocked(approveRequestItem).mockReturnValue(write.promise as never);
    renderPending();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm approve" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")
      ).toBe(true)
    );

    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    expect(screen.getByLabelText("Pickup by (optional)")).toBeTruthy();

    write.resolve();
    await waitFor(() =>
      expect(screen.queryByLabelText("Pickup by (optional)")).toBeNull()
    );
    // No focus assertion here. Two were tried and neither went red with
    // the guard reverted, so they asserted nothing; the mechanism was
    // not pinned down, and `export-csv-button.test.tsx` is the only
    // place in this repo where a jsdom focus claim has been verified.
    // Nothing covers the browser behaviour today: the accessibility
    // suite scans this page statically and never opens this surface.
  });

  /**
   * The trigger, not the confirm button inside the popover. That one was
   * always guarded; this one stayed live for the whole write and the refetch
   * behind it, offering to reopen a decision over a row the loader had not
   * caught up with (#426). What was broken is what the reader was told, not
   * what was written: the confirm button inside the popover was already
   * guarded, so the second decision never reached the server.
   */
  it.each([
    ["Approve", "Confirm approve"],
    ["Reject", "Confirm reject"],
  ])(
    "disables the %s trigger until the write settles",
    async (trigger, confirm) => {
      const write = deferred<void>();
      const fn = trigger === "Approve" ? approveRequestItem : rejectRequestItem;
      vi.mocked(fn).mockReturnValue(write.promise as never);
      renderPending();

      const button = () => screen.getByRole("button", { name: trigger });
      expect(button().hasAttribute("disabled")).toBe(false);

      fireEvent.click(button());
      if (trigger === "Reject") {
        fireEvent.change(screen.getByLabelText("Reason (sent to requester)"), {
          target: { value: "Out of stock" },
        });
      }
      fireEvent.click(screen.getByRole("button", { name: confirm }));

      await waitFor(() => expect(button().hasAttribute("disabled")).toBe(true));

      write.resolve();
      await waitFor(() =>
        expect(button().hasAttribute("disabled")).toBe(false)
      );
    }
  );

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
        onDone={() => Promise.resolve()}
        requesterEmail="student@x.edu"
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

  it("names the requester on both popovers and sends the skip with the decision (#387)", async () => {
    vi.mocked(approveRequestItem).mockResolvedValue({ ok: true });
    vi.mocked(rejectRequestItem).mockResolvedValue({ ok: true });
    renderPending();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    const approveBox = await screen.findByRole("checkbox", {
      name: "Email student@x.edu",
    });
    expect(approveBox.getAttribute("aria-checked")).toBe("true");
    expect(
      screen.getByText(
        "Uncheck to skip the email; the in-app notification is still sent."
      )
    ).toBeTruthy();
    fireEvent.click(approveBox);
    fireEvent.click(screen.getByRole("button", { name: "Confirm approve" }));
    await waitFor(() =>
      expect(approveRequestItem).toHaveBeenCalledWith({
        data: { requestItemId: "line-1", pickupBy: null, sendEmail: false },
      })
    );
    // The popover closes once the decision lands; opening the next one
    // before that would race its close.
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());

    // Checked again for the next decision: the skip was about that one.
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const rejectBox = await screen.findByRole("checkbox", {
      name: "Email student@x.edu",
    });
    expect(rejectBox.getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Reason (sent to requester)"), {
      target: { value: "Out of scope" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    await waitFor(() =>
      expect(rejectRequestItem).toHaveBeenCalledWith({
        data: {
          requestItemId: "line-1",
          reviewComment: "Out of scope",
          sendEmail: true,
        },
      })
    );
  });
});
