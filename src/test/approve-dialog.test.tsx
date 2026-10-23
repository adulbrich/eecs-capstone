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
import { ApproveDialog, type ApproveLine } from "#/components/approve-dialog";
import { approveRequestItem, approveRequestLines } from "#/server/inventory";
import { deferred } from "./shared/deferred";

vi.mock("#/server/inventory", () => ({
  approveRequestItem: vi.fn(),
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
  vi.mocked(approveRequestItem).mockReset();
  vi.mocked(approveRequestLines).mockReset();
});

const requester = { email: "student@x.edu", name: "Jordan Lee" };

const lines: ApproveLine[] = [
  { id: "b", itemName: "Oscilloscope", status: "pending" },
  { id: "a", itemName: "Soldering iron", status: "pending" },
  { id: "c", itemName: "Multimeter", status: "rejected" },
];

function renderRequest(onDone: () => Promise<void> = () => Promise.resolve()) {
  render(
    <ApproveDialog
      onDone={onDone}
      requester={requester}
      scope={{ kind: "request", lines }}
    />
  );
}

function renderLine(
  itemLocation: string | null = "Cabinet A, Bin 1",
  onDone: () => Promise<void> = () => Promise.resolve()
) {
  render(
    <ApproveDialog
      onDone={onDone}
      requester={requester}
      scope={{
        kind: "line",
        itemLocation,
        line: { id: "line-1", itemName: "Oscilloscope", status: "pending" },
      }}
    />
  );
}

function openDialog(trigger: "Approve" | "Approve all" = "Approve all") {
  fireEvent.click(screen.getByRole("button", { name: trigger }));
}

const place = () =>
  screen.getByLabelText("Where to pick up (optional)") as HTMLInputElement;

describe("ApproveDialog over a request", () => {
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
      renderRequest();
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
      // No focus assertion here. Two were tried and neither went red with the
      // guard reverted, so they asserted nothing. The mechanism is not pinned
      // down: focus is observable in jsdom through Radix (`tabs.test.tsx` asserts
      // `toHaveFocus` through a roving tabindex), but those tests drive it with
      // `userEvent` where these use `fireEvent.keyDown`, which is the first thing
      // to try if anyone picks this up.
    }
  );

  it("disables the Approve all trigger until the write settles", async () => {
    const write = deferred<{ approved: string[] }>();
    vi.mocked(approveRequestLines).mockReturnValue(write.promise as never);
    renderRequest();

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

  it("names the requester and lists only the pending lines it is about to approve", () => {
    renderRequest();
    openDialog();
    const dialog = screen.getByRole("dialog", {
      name: "Approve 2 lines for Jordan Lee",
    });
    expect(dialog.textContent).toContain("Oscilloscope");
    expect(dialog.textContent).toContain("Soldering iron");
    expect(dialog.textContent).not.toContain("Multimeter");
  });

  it("sends exactly the pending ids and one set of terms, then reports done", async () => {
    vi.mocked(approveRequestLines).mockResolvedValue({ approved: ["a", "b"] });
    const onDone = vi.fn(() => Promise.resolve());
    renderRequest(onDone);
    openDialog();
    fireEvent.change(screen.getByLabelText("Pickup day (optional)"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.change(place(), { target: { value: "KEC 1148" } });
    fireEvent.click(
      screen.getByRole("button", { name: "Confirm approve all" })
    );

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(approveRequestLines).toHaveBeenCalledWith({
      data: {
        requestItemIds: ["b", "a"],
        pickupDay: "2026-10-01",
        pickupFromTime: "",
        pickupToTime: "",
        pickupPlace: "KEC 1148",
        pickupNote: "",
        sendEmail: true,
      },
    });
    expect(approveRequestItem).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the server's refusal inside the dialog and stays open", async () => {
    vi.mocked(approveRequestLines).mockRejectedValue(
      new Error("Oscilloscope is no longer pending")
    );
    const onDone = vi.fn(() => Promise.resolve());
    renderRequest(onDone);
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
    renderRequest();
    openDialog();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(approveRequestLines).not.toHaveBeenCalled();
  });

  it("forgets the server's refusal when cancelled and reopened", async () => {
    vi.mocked(approveRequestLines).mockRejectedValue(
      new Error("Oscilloscope is no longer pending")
    );
    renderRequest();
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
      <ApproveDialog
        onDone={() => Promise.resolve()}
        requester={requester}
        scope={{
          kind: "request",
          lines: [{ id: "c", itemName: "Multimeter", status: "approved" }],
        }}
      />
    );
    expect(screen.queryByRole("button", { name: "Approve all" })).toBeNull();
  });

  it("carries the skip for the whole batch, and checks the box again after a Cancel (#387)", async () => {
    vi.mocked(approveRequestLines).mockResolvedValue({ approved: ["a", "b"] });
    const onDone = vi.fn(() => Promise.resolve());
    renderRequest(onDone);
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
      data: {
        requestItemIds: ["b", "a"],
        pickupDay: "",
        pickupFromTime: "",
        pickupToTime: "",
        pickupPlace: "",
        pickupNote: "",
        sendEmail: false,
      },
    });
  });

  /**
   * The items in one request can sit in different places, and none of them
   * is where the requester goes: staff decided the batch copies nothing in
   * and names no storage location anywhere in the dialog (#799).
   */
  it("starts the place blank and never names where an item is stored", () => {
    renderRequest();
    openDialog();
    expect(place().value).toBe("");
    expect(
      screen.getByText(
        "Left blank, the requester is told no place. They see what is here."
      )
    ).toBeTruthy();
  });
});

describe("ApproveDialog over one line", () => {
  it("names the item and the requester, and lists nothing", () => {
    renderLine();
    openDialog("Approve");
    const dialog = screen.getByRole("dialog", {
      name: "Approve Oscilloscope for Jordan Lee",
    });
    expect(dialog.querySelector("ul")).toBeNull();
  });

  it("falls back to the address when the requester has no name", () => {
    render(
      <ApproveDialog
        onDone={() => Promise.resolve()}
        requester={{ email: "student@x.edu", name: null }}
        scope={{
          kind: "line",
          itemLocation: null,
          line: { id: "line-1", itemName: "Oscilloscope", status: "pending" },
        }}
      />
    );
    openDialog("Approve");
    expect(
      screen.getByRole("dialog", {
        name: "Approve Oscilloscope for student@x.edu",
      })
    ).toBeTruthy();
  });

  /**
   * One item, so its location is copied in for staff to keep or replace, and
   * the hint says so; what staff typed is sent as typed, for the server to
   * compose in the office's zone (#799).
   */
  it("copies the item's location into the place and sends what staff typed", async () => {
    vi.mocked(approveRequestItem).mockResolvedValue({ ok: true });
    renderLine();
    openDialog("Approve");
    expect(place().value).toBe("Cabinet A, Bin 1");
    expect(
      screen.getByText(
        "Copied from the item's location. The requester sees what is here."
      )
    ).toBeTruthy();

    fireEvent.change(place(), { target: { value: "KEC 1148" } });
    fireEvent.change(screen.getByLabelText("Pickup day (optional)"), {
      target: { value: "2026-10-30" },
    });
    fireEvent.change(screen.getByLabelText("From"), {
      target: { value: "14:00" },
    });
    fireEvent.change(screen.getByLabelText("To"), {
      target: { value: "16:00" },
    });
    fireEvent.change(
      screen.getByLabelText("Note for the requester (optional)"),
      { target: { value: "Bring your ID." } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm approve" }));

    await waitFor(() =>
      expect(approveRequestItem).toHaveBeenCalledWith({
        data: {
          requestItemId: "line-1",
          pickupDay: "2026-10-30",
          pickupFromTime: "14:00",
          pickupToTime: "16:00",
          pickupPlace: "KEC 1148",
          pickupNote: "Bring your ID.",
          sendEmail: true,
        },
      })
    );
    expect(approveRequestLines).not.toHaveBeenCalled();
  });

  it("starts the place blank for an item with no location", () => {
    renderLine(null);
    openDialog("Approve");
    expect(place().value).toBe("");
    expect(screen.getByText("The requester sees what is here.")).toBeTruthy();
  });

  it("keeps what staff typed across a Cancel instead of copying the location back", async () => {
    renderLine();
    openDialog("Approve");
    fireEvent.change(place(), { target: { value: "KEC 1148" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    openDialog("Approve");
    expect(place().value).toBe("KEC 1148");
  });

  /**
   * Two activations inside one tick, which is the case `disabled` cannot
   * cover: the prop only stops the second click once React has re-rendered,
   * and a keyboard activation can arrive before it does (#443).
   */
  it("refuses a second confirm that arrives inside one tick", async () => {
    const write = deferred<{ ok: true }>();
    vi.mocked(approveRequestItem).mockReturnValue(write.promise as never);
    renderLine();
    openDialog("Approve");
    const confirm = screen.getByRole("button", { name: "Confirm approve" });

    // Not two `fireEvent.click` calls: those flush between, so the second
    // lands on a button React has already disabled and the test passes with
    // or without a guard. Dispatching both inside one act body is what puts
    // them in the same tick.
    await act(() => {
      confirm.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      confirm.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );
      return Promise.resolve();
    });

    expect(approveRequestItem).toHaveBeenCalledTimes(1);
    write.resolve({ ok: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("holds the trigger off while the caller says a sibling decision is writing", () => {
    render(
      <ApproveDialog
        disabled
        onDone={() => Promise.resolve()}
        requester={requester}
        scope={{
          kind: "line",
          itemLocation: null,
          line: { id: "line-1", itemName: "Oscilloscope", status: "pending" },
        }}
      />
    );
    expect(
      screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled")
    ).toBe(true);
  });
});
