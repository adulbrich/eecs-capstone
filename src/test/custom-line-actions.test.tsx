// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CustomLineActions,
  StartSourcingAllButton,
} from "#/components/custom-line-actions";
import { FulfillCustomLineDialog } from "#/components/fulfill-custom-line-dialog";
import { listAdminInventory } from "#/server/inventory";
import {
  fulfillCustomLine,
  rejectCustomLine,
  startSourcingCustomLine,
  updateSourcingNote,
} from "#/server/inventory-custom";
import { deferred } from "./shared/deferred";

vi.mock("#/server/inventory", () => ({ listAdminInventory: vi.fn() }));
vi.mock("#/server/inventory-custom", () => ({
  fulfillCustomLine: vi.fn(),
  rejectCustomLine: vi.fn(),
  startSourcingCustomLine: vi.fn(),
  updateSourcingNote: vi.fn(),
}));

// Radix Popover and Dialog read a few DOM APIs jsdom omits. Same stub set as
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
  vi.clearAllMocks();
});

const pending = {
  id: "c-1",
  name: "Thermal camera",
  quantity: 2,
  sourcingNote: null,
  status: "pending",
};

describe("CustomLineActions", () => {
  it("offers Start sourcing, Fulfil and Reject on a pending line, and never Approve", () => {
    render(
      <CustomLineActions
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    expect(
      screen.getByRole("button", { name: "Start sourcing" })
    ).toBeDefined();
    expect(screen.getByRole("button", { name: "Fulfil" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Reject" })).toBeDefined();
    expect(screen.queryByRole("button", { name: /Approve/ })).toBeNull();
  });

  it("turns the first button into Update note once sourcing, prefilled", async () => {
    vi.mocked(updateSourcingNote).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(
      <CustomLineActions
        line={{ ...pending, sourcingNote: "Ordered", status: "sourcing" }}
        onDone={onDone}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Update note" }));
    const note = screen.getByLabelText("New note (sent to requester)");
    expect((note as HTMLTextAreaElement).value).toBe("Ordered");
    fireEvent.change(note, { target: { value: "Slipped a week" } });
    fireEvent.click(screen.getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(updateSourcingNote).toHaveBeenCalledWith({
      data: { customLineId: "c-1", sourcingNote: "Slipped a week" },
    });
  });

  it("starts sourcing with an optional note", async () => {
    vi.mocked(startSourcingCustomLine).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(
      <CustomLineActions
        line={pending}
        onDone={onDone}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Start sourcing" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm sourcing" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(startSourcingCustomLine).toHaveBeenCalledWith({
      data: { customLineId: "c-1", sourcingNote: null },
    });
  });

  it("refuses a rejection without a reason before it reaches the server", () => {
    render(
      <CustomLineActions
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    expect(screen.getByText("Reason required")).toBeDefined();
    expect(rejectCustomLine).not.toHaveBeenCalled();
  });

  it("offers nothing on a closed line", () => {
    render(
      <CustomLineActions
        line={{ ...pending, status: "fulfilled" }}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("CustomLineActions email skip (#387)", () => {
  it("names the requester on Reject and sends the skip", async () => {
    vi.mocked(rejectCustomLine).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(
      <CustomLineActions
        line={pending}
        onDone={onDone}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const box = await screen.findByRole("checkbox", {
      name: "Email requester@x.edu",
    });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    fireEvent.change(screen.getByLabelText("Reason (sent to requester)"), {
      target: { value: "No budget" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm reject" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(rejectCustomLine).toHaveBeenCalledWith({
      data: { customLineId: "c-1", outcomeNote: "No budget", sendEmail: false },
    });
  });

  it("carries the box into the Fulfil dialog, checked", async () => {
    render(
      <CustomLineActions
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Fulfil" }));
    const dialog = await screen.findByRole("dialog");
    const box = within(dialog).getByRole("checkbox", {
      name: "Email requester@x.edu",
    });
    expect(box.getAttribute("aria-checked")).toBe("true");
  });
});

describe("StartSourcingAllButton", () => {
  it("sources every pending line, one call each, and nothing for a decided one", async () => {
    vi.mocked(startSourcingCustomLine).mockResolvedValue({ ok: true });
    const onDone = vi.fn();
    render(
      <StartSourcingAllButton
        lines={[
          { id: "a", status: "pending" },
          { id: "b", status: "sourcing" },
          { id: "c", status: "pending" },
        ]}
        onDone={onDone}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Start sourcing all" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(
      vi.mocked(startSourcingCustomLine).mock.calls.map((c) => c[0])
    ).toEqual([
      { data: { customLineId: "a", sourcingNote: null } },
      { data: { customLineId: "c", sourcingNote: null } },
    ]);
  });

  it("renders nothing when no line is pending", () => {
    render(
      <StartSourcingAllButton
        lines={[{ id: "b", status: "sourcing" }]}
        onDone={vi.fn()}
      />
    );
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says how far it got when a line part way through fails", async () => {
    vi.mocked(startSourcingCustomLine)
      .mockResolvedValueOnce({ ok: true })
      .mockRejectedValueOnce(new Error("Line no longer pending"));
    const onDone = vi.fn();
    render(
      <StartSourcingAllButton
        lines={[
          { id: "a", status: "pending" },
          { id: "b", status: "pending" },
          { id: "c", status: "pending" },
        ]}
        onDone={onDone}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Start sourcing all" }));

    // "Sourcing failed" alone invited a retry that would have transitioned
    // the line already sourcing a second time.
    expect(
      await screen.findByText(
        "Started 1 of 3, then stopped: Line no longer pending"
      )
    ).toBeDefined();
    // The first line is sourcing on the server whatever the rest did, so the
    // table is refreshed either way.
    expect(onDone).toHaveBeenCalled();
    expect(vi.mocked(startSourcingCustomLine)).toHaveBeenCalledTimes(2);
  });

  it("reports the failure plainly when the first line is the one that fails", async () => {
    vi.mocked(startSourcingCustomLine).mockRejectedValue(
      new Error("Not signed in")
    );
    render(
      <StartSourcingAllButton
        lines={[{ id: "a", status: "pending" }]}
        onDone={vi.fn()}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Start sourcing all" }));
    expect(await screen.findByText("Not signed in")).toBeDefined();
  });
});

describe("CustomLineActions: the trigger during its own write", () => {
  /**
   * The triggers, not the confirm buttons inside their popovers. Those were
   * always guarded; these stayed live for the whole write and the refetch
   * behind it, offering to reopen a decision over a row the loader had not
   * caught up with (#426). `useAction`'s in-flight ref means the second
   * decision never reached the server, so what was broken is what the reader
   * was offered, not what was written.
   */
  it.each([
    ["Start sourcing", "Confirm sourcing", startSourcingCustomLine],
    ["Reject", "Confirm reject", rejectCustomLine],
  ])(
    "disables the %s trigger until the write settles",
    async (trigger, confirm, fn) => {
      const write = deferred<void>();
      vi.mocked(fn).mockReturnValue(write.promise as never);
      render(
        <CustomLineActions
          line={pending}
          onDone={() => Promise.resolve()}
          requesterEmail="requester@x.edu"
        />
      );

      const button = () => screen.getByRole("button", { name: trigger });
      expect(button().hasAttribute("disabled")).toBe(false);

      fireEvent.click(button());
      if (trigger === "Reject") {
        fireEvent.change(screen.getByLabelText("Reason (sent to requester)"), {
          target: { value: "Cannot source it" },
        });
      }
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: confirm,
        })
      );

      await waitFor(() => expect(button().hasAttribute("disabled")).toBe(true));

      write.resolve();
      await waitFor(() =>
        expect(button().hasAttribute("disabled")).toBe(false)
      );
    }
  );
});

describe("CustomLineActions: dismissing during its own write", () => {
  /**
   * The guard in `openChange`, the last of this PR's four dismissal guards
   * to get a test. Escape on a non-modal Radix Popover does reach
   * `onOpenChange` in jsdom, so this can fail: drop the `busy` branch and
   * the dialog query below throws.
   */
  it.each(["Start sourcing", "Reject"])(
    "refuses to close the %s popover mid-write",
    async (trigger) => {
      const write = deferred<void>();
      const fn =
        trigger === "Reject" ? rejectCustomLine : startSourcingCustomLine;
      vi.mocked(fn).mockReturnValue(write.promise as never);
      render(
        <CustomLineActions
          line={pending}
          onDone={() => Promise.resolve()}
          requesterEmail="requester@x.edu"
        />
      );

      fireEvent.click(screen.getByRole("button", { name: trigger }));
      if (trigger === "Reject") {
        fireEvent.change(screen.getByLabelText("Reason (sent to requester)"), {
          target: { value: "Cannot source it" },
        });
      }
      const confirm =
        trigger === "Reject" ? "Confirm reject" : "Confirm sourcing";
      fireEvent.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: confirm,
        })
      );
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: trigger }).hasAttribute("disabled")
        ).toBe(true)
      );

      fireEvent.keyDown(document.activeElement ?? document.body, {
        key: "Escape",
      });
      expect(screen.getByRole("dialog")).toBeTruthy();

      write.resolve();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
  );
});

describe("CustomLineActions: cancelling a popover", () => {
  it("closes the sourcing popover without writing, and keeps the note", async () => {
    render(
      <CustomLineActions
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Start sourcing" }));
    fireEvent.change(
      screen.getByLabelText("Note for the requester (optional)"),
      { target: { value: "Half typed" } }
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Note for the requester (optional)")
      ).toBeNull()
    );
    expect(startSourcingCustomLine).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Start sourcing" }));
    expect(
      (
        screen.getByLabelText(
          "Note for the requester (optional)"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("Half typed");
  });

  it("closes the reject popover without writing", async () => {
    render(
      <CustomLineActions
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    fireEvent.change(screen.getByLabelText("Reason (sent to requester)"), {
      target: { value: "Not stocked" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() =>
      expect(screen.queryByLabelText("Reason (sent to requester)")).toBeNull()
    );
    expect(rejectCustomLine).not.toHaveBeenCalled();
  });

  /**
   * The two halves of `docs/QUIRKS.md` "A Cancel button that sets `open`
   * itself skips the dialog's `onOpenChange`", which asks that every control
   * closing a surface run the same cleanup. These two ran different halves:
   * Cancel cleared the error and left the skip, Escape reset the skip and
   * left the error. `admin-request-actions.tsx` is the shape both now share.
   */
  it("checks the email box again after Cancel: the skip was one click's", async () => {
    render(
      <CustomLineActions
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const box = await screen.findByRole("checkbox", {
      name: "Email requester@x.edu",
    });
    fireEvent.click(box);
    expect(box.getAttribute("aria-checked")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("checkbox")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    const reopened = await screen.findByRole("checkbox", {
      name: "Email requester@x.edu",
    });
    expect(reopened.getAttribute("aria-checked")).toBe("true");
  });

  it("does not carry a failed action's error onto the next popover", async () => {
    vi.mocked(startSourcingCustomLine).mockRejectedValue(
      new Error("server said no")
    );
    render(
      <CustomLineActions
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Start sourcing" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm sourcing" }));
    // `useAction` shows the rejection's own message when it carries one.
    expect(await screen.findByText("server said no")).toBeTruthy();

    // Escape rather than Cancel: it is the route that skipped the reset.
    fireEvent.keyDown(document.activeElement ?? document.body, {
      key: "Escape",
    });
    await waitFor(() =>
      expect(
        screen.queryByLabelText("Note for the requester (optional)")
      ).toBeNull()
    );

    // The three actions share one error slot, so a stale one lands under an
    // untouched rejection.
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    await screen.findByLabelText("Reason (sent to requester)");
    expect(screen.queryByText("server said no")).toBeNull();
  });
});

describe("FulfillCustomLineDialog", () => {
  /** Opens the dialog, searches, and links the first match. */
  async function linkFirstMatch() {
    vi.mocked(listAdminInventory).mockResolvedValue({
      rows: [
        { id: "i-1", name: "FLIR One" },
        { id: "i-2", name: "FLIR Two" },
      ],
    } as never);
    fireEvent.click(screen.getByRole("button", { name: "Fulfil" }));
    fireEvent.change(screen.getByLabelText("Find an available item"), {
      target: { value: "FLIR" },
    });
    await waitFor(() => expect(screen.getByText("FLIR One")).toBeDefined());
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    expect(
      screen.getByRole("list", { name: "Linked items" }).textContent
    ).toContain("FLIR One");
  }

  /**
   * The trigger, not the confirm button inside the dialog. Same defect as the
   * popovers above (#426): it stayed live through the fulfilment and the
   * refetch behind it.
   */
  /**
   * The other half of #426's focus problem, on the second dialog. One
   * representative test was not enough: the first fix guarded Escape and
   * outside clicks and left the close X, which `DialogContent` renders by
   * default and which reaches `onOpenChange` directly, so the X is tested
   * explicitly here rather than taken on trust.
   */
  it.each(["Escape", "close X"])(
    "refuses to close mid-write via %s",
    async (route) => {
      const write = deferred<void>();
      vi.mocked(fulfillCustomLine).mockReturnValue(write.promise as never);
      render(
        <FulfillCustomLineDialog
          line={pending}
          onDone={() => Promise.resolve()}
          requesterEmail="requester@x.edu"
        />
      );
      await linkFirstMatch();
      fireEvent.click(screen.getByRole("button", { name: "Confirm fulfil" }));
      await waitFor(() =>
        expect(
          screen
            .getByRole("button", { hidden: true, name: "Fulfil" })
            .hasAttribute("disabled")
        ).toBe(true)
      );

      if (route === "Escape") {
        fireEvent.keyDown(document.activeElement ?? document.body, {
          key: "Escape",
        });
      } else {
        fireEvent.click(screen.getByRole("button", { name: /close/i }));
      }
      expect(screen.getByRole("dialog")).toBeTruthy();

      write.resolve();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      // No focus assertion here. Two were tried and neither went red with the
      // guard reverted, so they asserted nothing. The mechanism is not pinned
      // down: focus is observable in jsdom through Radix (`tabs.test.tsx` asserts
      // `toHaveFocus` through a roving tabindex), but those tests drive it with
      // `userEvent` where these use `fireEvent.keyDown`, which is the first thing
      // to try if anyone picks this up.
      // Nothing covers the browser behaviour today, and unlike the reject
      // popover no browser test opens this dialog at all.
    }
  );

  it("disables the Fulfil trigger until the write settles", async () => {
    const write = deferred<void>();
    vi.mocked(fulfillCustomLine).mockReturnValue(write.promise as never);
    render(
      <FulfillCustomLineDialog
        line={pending}
        onDone={() => Promise.resolve()}
        requesterEmail="requester@x.edu"
      />
    );

    // `hidden` because this dialog is modal, unlike the popovers above: the
    // overlay `aria-hidden`s the trigger while it is open.
    const button = () =>
      screen.getByRole("button", { hidden: true, name: "Fulfil" });
    expect(button().hasAttribute("disabled")).toBe(false);

    await linkFirstMatch();
    fireEvent.click(screen.getByRole("button", { name: "Confirm fulfil" }));
    await waitFor(() => expect(button().hasAttribute("disabled")).toBe(true));

    write.resolve();
    await waitFor(() => expect(button().hasAttribute("disabled")).toBe(false));
  });

  it("unlinks an item and offers it again", async () => {
    render(
      <FulfillCustomLineDialog
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    await linkFirstMatch();
    // Linking takes the item out of the matches; the Add buttons left are
    // for the others.
    expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Remove FLIR One" }));
    expect(screen.queryByRole("list", { name: "Linked items" })).toBeNull();
    expect(screen.getByText("Nothing linked yet.")).toBeDefined();
    expect(screen.getAllByRole("button", { name: "Add" })).toHaveLength(2);
    expect(fulfillCustomLine).not.toHaveBeenCalled();
  });

  it("closes on Cancel without writing, and starts over when reopened", async () => {
    render(
      <FulfillCustomLineDialog
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    await linkFirstMatch();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(fulfillCustomLine).not.toHaveBeenCalled();

    // Unlike the other dialogs, this one resets on close: a half-built link
    // set is not something to find again on a later line.
    fireEvent.click(screen.getByRole("button", { name: "Fulfil" }));
    expect(screen.getByText("Nothing linked yet.")).toBeDefined();
    expect(
      (screen.getByLabelText("Find an available item") as HTMLInputElement)
        .value
    ).toBe("");
  });

  it("finds available items, links the chosen ones, and reserves by default", async () => {
    vi.mocked(listAdminInventory).mockResolvedValue({
      rows: [
        { id: "i-1", name: "FLIR One" },
        { id: "i-2", name: "FLIR Two" },
      ],
    } as never);
    vi.mocked(fulfillCustomLine).mockResolvedValue({
      ok: true,
      itemIds: ["i-1"],
    });
    const onDone = vi.fn();
    render(
      <FulfillCustomLineDialog
        line={pending}
        onDone={onDone}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Fulfil" }));
    fireEvent.change(screen.getByLabelText("Find an available item"), {
      target: { value: "FLIR" },
    });
    await waitFor(() => expect(screen.getByText("FLIR One")).toBeDefined());
    expect(listAdminInventory).toHaveBeenCalledWith({
      data: {
        categories: [],
        q: "FLIR",
        retiredOnly: false,
        status: "available",
      },
    });
    fireEvent.click(screen.getAllByRole("button", { name: "Add" })[0]);
    expect(
      screen.getByRole("list", { name: "Linked items" }).textContent
    ).toContain("FLIR One");
    fireEvent.change(screen.getByLabelText("Pickup by (optional)"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm fulfil" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(fulfillCustomLine).toHaveBeenCalledWith({
      data: {
        customLineId: "c-1",
        itemIds: ["i-1"],
        outcomeNote: null,
        pickupBy: new Date("2026-10-01"),
        reserve: true,
        sendEmail: true,
      },
    });
  });

  it("refuses to confirm with nothing linked", () => {
    render(
      <FulfillCustomLineDialog
        line={pending}
        onDone={vi.fn()}
        requesterEmail="requester@x.edu"
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Fulfil" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm fulfil" }));
    expect(screen.getByText("Link at least one item")).toBeDefined();
    expect(fulfillCustomLine).not.toHaveBeenCalled();
  });
});
