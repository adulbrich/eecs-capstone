// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { INVENTORY_ITEM_STATUSES, type ItemStatus } from "#/lib/vocabularies";
import { renderWithQueryClient } from "./shared/query-client";

const { router, server } = vi.hoisted(() => ({
  router: {
    invalidate: vi.fn(() => Promise.resolve()),
    navigate: vi.fn(() => Promise.resolve()),
  },
  server: {
    hardDeleteInventoryItem: vi.fn(() => Promise.resolve({ ok: true })),
    listInventoryItemEditLog: vi.fn(() => Promise.resolve({ rows: [] })),
    transitionInventoryItem: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

vi.mock("#/server/inventory", () => server);
// HolderField's account lookup, answering "nobody" in the shapes the real
// functions use. The dialog it lives in is opened below but never filled in.
vi.mock("#/server/users", () => ({
  lookupUserByEmail: vi.fn(() => Promise.resolve(null)),
  searchUsers: vi.fn(() => Promise.resolve([])),
}));
// The real module beside the stub router: the edit log's `queryFn` calls
// `isRedirect` on a failure.
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useRouter: () => router,
}));

import {
  type HistoryRow,
  InventoryLifecyclePanel,
} from "#/components/inventory-lifecycle-panel";
import {
  HARD_DELETE_HISTORY_REFUSAL,
  needsHolder,
} from "#/lib/inventory-workflow";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const STATUSES: ItemStatus[] = [...INVENTORY_ITEM_STATUSES];

function renderPanel(
  overrides: {
    status?: ItemStatus;
    hasRequestHistory?: boolean;
    history?: HistoryRow[];
  } = {}
) {
  return renderWithQueryClient(panel(overrides));
}

function panel(
  overrides: {
    status?: ItemStatus;
    hasRequestHistory?: boolean;
    history?: HistoryRow[];
  } = {},
  key?: string
) {
  return (
    <InventoryLifecyclePanel
      hasRequestHistory={overrides.hasRequestHistory ?? false}
      history={overrides.history ?? []}
      item={{
        id: "item-1",
        name: "Oscilloscope",
        status: overrides.status ?? "available",
        currentHolderId: null,
        currentHolderLabel: null,
        currentRequestItemId: null,
      }}
      key={key}
    />
  );
}

const hardDeleteTrigger = () =>
  screen.getByRole("button", { name: "Hard delete item" });

describe("InventoryLifecyclePanel: the hard delete gate", () => {
  // Both inputs, every combination. The rule is the server's (#152 made the
  // button agree with it up front rather than after a typed confirmation), so
  // a status the server would refuse must not offer the button either.
  const cases = STATUSES.flatMap((status) =>
    [false, true].map((hasRequestHistory) => ({ status, hasRequestHistory }))
  );

  it.each(cases)(
    "offers hard delete for $status with request history $hasRequestHistory only when both allow it",
    ({ status, hasRequestHistory }) => {
      renderPanel({ status, hasRequestHistory });
      const allowed =
        (status === "available" || status === "retired") && !hasRequestHistory;
      expect(hardDeleteTrigger()).toHaveProperty("disabled", !allowed);
    }
  );

  it("shows the server's refusal beside the disabled button, and only then", () => {
    const { unmount } = renderPanel({ hasRequestHistory: true });
    // The same string the server throws, so a reader sees the reason before
    // typing anything.
    expect(screen.getByText(HARD_DELETE_HISTORY_REFUSAL)).toBeDefined();
    unmount();

    renderPanel({ hasRequestHistory: false });
    expect(screen.queryByText(HARD_DELETE_HISTORY_REFUSAL)).toBeNull();
  });
});

describe("InventoryLifecyclePanel: the recommended transition per status", () => {
  const recommended: Record<
    ItemStatus,
    { label: string; next: ItemStatus } | null
  > = {
    available: { label: "Check out", next: "checked_out" },
    requested: { label: "Approve / reserve", next: "reserved" },
    reserved: { label: "Check out", next: "checked_out" },
    checked_out: { label: "Return", next: "available" },
    maintenance: { label: "Mark available", next: "available" },
    retired: null,
  };

  it("offers no recommended action for a retired item", () => {
    renderPanel({ status: "retired" });
    for (const entry of Object.values(recommended)) {
      if (entry) {
        expect(screen.queryByRole("button", { name: entry.label })).toBeNull();
      }
    }
  });

  it.each(
    STATUSES.flatMap((status) => {
      const entry = recommended[status];
      return entry ? [{ status, ...entry }] : [];
    })
  )(
    "$status offers $label, and asks who holds the item exactly when the rules say the target needs a holder",
    async ({ status, label, next }) => {
      renderPanel({ status });
      fireEvent.click(screen.getByRole("button", { name: label }));

      if (needsHolder(next)) {
        // Reserving or checking out names a person or a label first. The
        // dialog is that question; nothing is sent until it is answered.
        expect(await screen.findByRole("dialog")).toBeDefined();
        expect(server.transitionInventoryItem).not.toHaveBeenCalled();
      } else {
        await waitFor(() =>
          expect(server.transitionInventoryItem).toHaveBeenCalledTimes(1)
        );
        expect(server.transitionInventoryItem).toHaveBeenCalledWith({
          data: expect.objectContaining({ itemId: "item-1", nextStatus: next }),
        });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(router.invalidate).toHaveBeenCalledTimes(1);
      }
    }
  );
});

describe("InventoryLifecyclePanel: the status override", () => {
  // Radix's Select opens through pointer capture, which jsdom does not
  // implement. The same four stubs proposer-picker.test.tsx installs.
  beforeAll(() => {
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.hasPointerCapture = vi.fn();
    Element.prototype.setPointerCapture = vi.fn();
    Element.prototype.releasePointerCapture = vi.fn();
  });

  async function pickOverride(next: ItemStatus) {
    fireEvent.pointerDown(
      screen.getByRole("combobox", { name: "Change status to..." }),
      { button: 0, ctrlKey: false, pointerType: "mouse" }
    );
    fireEvent.click(
      await screen.findByRole("option", { name: next.replace(/_/gu, " ") })
    );
  }

  // The same rule as the recommended button, asked of the other handler:
  // the override opens the holder dialog exactly when needsHolder says so.
  // "requested" is excluded because the panel refuses it outright, and
  // "available" because it is the rendered item's own status.
  it.each(
    STATUSES.filter((s) => s !== "requested" && s !== "available").map(
      (next) => ({ next })
    )
  )(
    "overriding to $next asks who holds the item exactly when the rules say the target needs a holder",
    async ({ next }) => {
      renderPanel({ status: "available" });
      await pickOverride(next);

      if (needsHolder(next)) {
        expect(await screen.findByRole("dialog")).toBeDefined();
        expect(server.transitionInventoryItem).not.toHaveBeenCalled();
      } else {
        await waitFor(() =>
          expect(server.transitionInventoryItem).toHaveBeenCalledTimes(1)
        );
        expect(server.transitionInventoryItem).toHaveBeenCalledWith({
          data: expect.objectContaining({ itemId: "item-1", nextStatus: next }),
        });
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(router.invalidate).toHaveBeenCalledTimes(1);
      }
    }
  );

  it("refuses 'requested' with its own message and sends nothing", async () => {
    renderPanel({ status: "available" });
    await pickOverride("requested");

    expect(
      await screen.findByText(
        "Cannot directly set 'requested'; use the request queue."
      )
    ).toBeDefined();
    expect(server.transitionInventoryItem).not.toHaveBeenCalled();
  });
});

describe("InventoryLifecyclePanel: what a failed transition shows", () => {
  it("renders the server's message verbatim", async () => {
    server.transitionInventoryItem.mockRejectedValueOnce(
      new Error("Cannot set holder or request on transition to available")
    );
    renderPanel({ status: "checked_out" });
    fireEvent.click(screen.getByRole("button", { name: "Return" }));
    expect(
      await screen.findByText(
        "Cannot set holder or request on transition to available"
      )
    ).toBeDefined();
    expect(router.invalidate).not.toHaveBeenCalled();
  });

  it("falls back to its own words when the error carries no message", async () => {
    server.transitionInventoryItem.mockRejectedValueOnce({});
    renderPanel({ status: "maintenance" });
    fireEvent.click(screen.getByRole("button", { name: "Mark available" }));
    expect(await screen.findByText("Transition failed")).toBeDefined();
  });
});

describe("InventoryLifecyclePanel: the hard delete confirmation", () => {
  function openDeleteDialog() {
    fireEvent.click(hardDeleteTrigger());
    return {
      confirm: screen.getByRole("button", { name: "Hard delete" }),
      input: screen.getByLabelText("Confirm item name"),
    };
  }

  it("is an alert dialog, and opens with focus on the name input", async () => {
    renderPanel();
    const { input } = openDeleteDialog();
    // The role and the focus rule: docs/UI-CONVENTIONS.md, Destructive actions.
    expect(screen.getByRole("alertdialog")).toBeDefined();
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("keeps the destructive button disabled until the exact item name is typed", () => {
    renderPanel();
    const { confirm, input } = openDeleteDialog();
    expect(confirm).toHaveProperty("disabled", true);

    fireEvent.change(input, { target: { value: "oscilloscope" } });
    expect(confirm).toHaveProperty("disabled", true);

    fireEvent.change(input, { target: { value: "Oscilloscope" } });
    expect(confirm).toHaveProperty("disabled", false);
  });

  it("sends the typed name with the id, then leaves for the management table", async () => {
    renderPanel();
    const { confirm, input } = openDeleteDialog();
    fireEvent.change(input, { target: { value: "Oscilloscope" } });
    fireEvent.click(confirm);

    await waitFor(() =>
      expect(server.hardDeleteInventoryItem).toHaveBeenCalledWith({
        data: { id: "item-1", confirmName: "Oscilloscope" },
      })
    );
    await waitFor(() =>
      expect(router.navigate).toHaveBeenCalledWith({ to: "/admin/inventory" })
    );
  });

  it("forgets a typed name when the dialog is cancelled and reopened", () => {
    renderPanel();
    const first = openDeleteDialog();
    fireEvent.change(first.input, { target: { value: "Oscilloscope" } });
    expect(first.confirm).toHaveProperty("disabled", false);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    // A Cancel must not leave the next opening pre-armed.
    const second = openDeleteDialog();
    expect(second.confirm).toHaveProperty("disabled", true);
  });

  it("shows the server's refusal verbatim, and its own words when there is none", async () => {
    server.hardDeleteInventoryItem.mockRejectedValueOnce(
      new Error(HARD_DELETE_HISTORY_REFUSAL)
    );
    renderPanel();
    const { confirm, input } = openDeleteDialog();
    fireEvent.change(input, { target: { value: "Oscilloscope" } });
    fireEvent.click(confirm);
    // Scoped to the dialog: the panel shows the same error under the danger
    // zone too, and the dialog is where the person who clicked is looking.
    const dialog = within(screen.getByRole("alertdialog"));
    expect(await dialog.findByText(HARD_DELETE_HISTORY_REFUSAL)).toBeDefined();
    expect(router.navigate).not.toHaveBeenCalled();

    server.hardDeleteInventoryItem.mockRejectedValueOnce({});
    fireEvent.click(confirm);
    expect(await dialog.findByText("Delete failed")).toBeDefined();
  });
});

describe("InventoryLifecyclePanel: the status history", () => {
  /** `count` rows, each carrying its own number in the comment. */
  function historyOf(count: number): HistoryRow[] {
    return Array.from({ length: count }, (_, i) => ({
      changedByEmail: "staff@example.com",
      changedByName: "Staff",
      comment: `entry ${i + 1}`,
      createdAt: new Date(2026, 0, 1, 0, i),
      holderEmail: null,
      holderId: null,
      holderLabel: null,
      holderName: null,
      holderProgram: null,
      id: `h-${i + 1}`,
      newStatus: "available",
      oldStatus: "checked_out",
    }));
  }

  it("offers no paging when the history fits one page", () => {
    renderPanel({ history: historyOf(10) });
    expect(screen.getByText("entry 10")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Previous" })).toBeNull();
  });

  // The count is PaginationStatus's, the same wording every other list uses,
  // rather than the bare "Page 1 of 2" span this pager carried before #392.
  it("pages forward and back, stopping at either end", () => {
    renderPanel({ history: historyOf(12) });
    const next = screen.getByRole("button", { name: "Next" });
    const previous = screen.getByRole("button", { name: "Previous" });
    expect(
      screen.getByText("Page 1 of 2 \u00b7 10 of 12 results")
    ).toBeDefined();
    expect(screen.getByText("entry 1")).toBeDefined();
    expect(screen.queryByText("entry 11")).toBeNull();
    expect(previous).toHaveProperty("disabled", true);

    fireEvent.click(next);
    expect(
      screen.getByText("Page 2 of 2 \u00b7 2 of 12 results")
    ).toBeDefined();
    expect(screen.getByText("entry 11")).toBeDefined();
    expect(screen.queryByText("entry 1")).toBeNull();
    expect(next).toHaveProperty("disabled", true);

    fireEvent.click(previous);
    expect(
      screen.getByText("Page 1 of 2 \u00b7 10 of 12 results")
    ).toBeDefined();
    expect(screen.getByText("entry 1")).toBeDefined();
  });
});

describe("InventoryLifecyclePanel: the checkout dialog", () => {
  it("names the typed holder on the skip, disables it for a label hold, and sends the choice (#387)", async () => {
    renderPanel({ status: "available" });
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(
        "A holder with an address receives pickup and due emails there."
      )
    ).toBeTruthy();
    // Nothing typed yet: the box is disabled and says so.
    const idle = within(dialog).getByRole("checkbox", {
      name: "No address on file, no email will be sent",
    });
    expect(idle.hasAttribute("disabled")).toBe(true);

    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "holder@x.edu" },
    });
    const box = await within(dialog).findByRole("checkbox", {
      name: "Email holder@x.edu",
    });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(
      within(dialog).getByText(
        "Uncheck to skip the email; a holder with an account still gets the in-app notification."
      )
    ).toBeTruthy();
    fireEvent.click(box);
    fireEvent.change(within(dialog).getByLabelText("Due date"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(server.transitionInventoryItem).toHaveBeenCalledWith({
        data: expect.objectContaining({
          nextStatus: "checked_out",
          holderEmail: "holder@x.edu",
          sendEmail: false,
        }),
      })
    );
  });

  it("stays open and shows the refusal inside when the transition fails", async () => {
    server.transitionInventoryItem.mockRejectedValueOnce(
      new Error("Item is already checked out")
    );
    renderPanel({ status: "available" });
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "holder@x.edu" },
    });
    fireEvent.change(within(dialog).getByLabelText("Due date"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    // It used to close whatever happened, which put the refusal in the panel
    // behind a dialog that had already gone.
    expect(await screen.findByText("Item is already checked out")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("takes the refusal with it when the dialog is cancelled", async () => {
    server.transitionInventoryItem.mockRejectedValueOnce(
      new Error("Item is already checked out")
    );
    renderPanel({ status: "available" });
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "holder@x.edu" },
    });
    fireEvent.change(within(dialog).getByLabelText("Due date"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Item is already checked out")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    // The panel behind shares the one error state. Left uncleared, the
    // refusal reappears there as a failure of nothing the reader just did.
    expect(screen.queryByText("Item is already checked out")).toBeNull();
  });

  it("closes on Cancel without transitioning", async () => {
    renderPanel({ status: "available" });
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(server.transitionInventoryItem).not.toHaveBeenCalled();
    expect(router.invalidate).not.toHaveBeenCalled();
  });
});

describe("InventoryLifecyclePanel: the pickup terms on a reserve (#799)", () => {
  function renderRequested(location: string | null) {
    return renderWithQueryClient(
      <InventoryLifecyclePanel
        hasRequestHistory
        history={[]}
        item={{
          id: "item-1",
          name: "Oscilloscope",
          status: "requested",
          currentHolderId: "u-1",
          currentHolderEmail: "student@x.edu",
          currentHolderLabel: null,
          currentRequestItemId: "line-1",
          location,
        }}
      />
    );
  }

  it("copies the location in, says which text box is sent, and sends the terms as typed", async () => {
    renderRequested("Cabinet A, Bin 1");
    fireEvent.click(screen.getByRole("button", { name: "Approve / reserve" }));
    const dialog = await screen.findByRole("dialog");

    const place = within(dialog).getByLabelText("Where to pick up (optional)");
    expect((place as HTMLInputElement).value).toBe("Cabinet A, Bin 1");
    expect(
      within(dialog).getByText(
        "Copied from the item's location. The holder sees what is here."
      )
    ).toBeTruthy();
    expect(
      within(dialog).getByText(
        "Kept in the status history for staff. Not sent to the holder."
      )
    ).toBeTruthy();

    fireEvent.change(place, { target: { value: "KEC 1148" } });
    fireEvent.change(within(dialog).getByLabelText("Pickup day (optional)"), {
      target: { value: "2026-10-30" },
    });
    fireEvent.change(within(dialog).getByLabelText("From"), {
      target: { value: "14:00" },
    });
    fireEvent.change(within(dialog).getByLabelText("To"), {
      target: { value: "16:00" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));

    await waitFor(() =>
      expect(server.transitionInventoryItem).toHaveBeenCalledWith({
        data: expect.objectContaining({
          nextStatus: "reserved",
          requestItemId: "line-1",
          pickupDay: "2026-10-30",
          pickupFromTime: "14:00",
          pickupToTime: "16:00",
          pickupPlace: "KEC 1148",
          pickupNote: "",
        }),
      })
    );
  });

  it("reads back what the holder was told, and nothing it was not", () => {
    renderWithQueryClient(
      <InventoryLifecyclePanel
        hasRequestHistory={false}
        history={[]}
        item={{
          id: "item-1",
          name: "Oscilloscope",
          status: "reserved",
          currentHolderId: null,
          currentHolderEmail: "walkin@x.edu",
          currentHolderLabel: null,
          currentRequestItemId: null,
          location: "Cabinet A, Bin 1",
          pickupFrom: "2026-10-30T21:00:00.000Z",
          pickupBy: "2026-10-30T23:00:00.000Z",
          pickupPlace: "KEC 1148",
          pickupNote: null,
        }}
      />
    );
    expect(screen.getByText("Oct 30, 2026, 2:00 PM to 4:00 PM")).toBeTruthy();
    expect(screen.getByText("KEC 1148")).toBeTruthy();
    expect(screen.queryByText("Pickup note")).toBeNull();
    // The storage location is the private panel's, not a pickup term.
    expect(screen.queryByText("Cabinet A, Bin 1")).toBeNull();
  });

  it("sends no pickup terms on a checkout", async () => {
    renderPanel({ status: "available" });
    fireEvent.click(screen.getByRole("button", { name: "Check out" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByLabelText("Pickup day (optional)")).toBeNull();
    fireEvent.change(within(dialog).getByLabelText("Email"), {
      target: { value: "holder@x.edu" },
    });
    fireEvent.change(within(dialog).getByLabelText("Due date"), {
      target: { value: "2026-10-01" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(server.transitionInventoryItem).toHaveBeenCalledWith({
        data: expect.objectContaining({
          nextStatus: "checked_out",
          pickupDay: "",
          pickupPlace: "",
        }),
      })
    );
  });
});

describe("InventoryLifecyclePanel edit log", () => {
  const row = {
    id: "log-1",
    changedFields: ["location"],
    createdAt: "2026-10-01T10:00:00.000Z",
    editorName: "Grace Hopper",
  };

  it("renders the log it reads for the item", async () => {
    server.listInventoryItemEditLog.mockResolvedValueOnce({
      rows: [row],
    } as never);
    renderPanel();

    expect(await screen.findByText(/Grace Hopper/u)).toBeTruthy();
    expect(server.listInventoryItemEditLog).toHaveBeenCalledWith({
      data: { itemId: "item-1" },
    });
  });

  it("says the read failed rather than claiming the item has no edits", async () => {
    server.listInventoryItemEditLog.mockRejectedValueOnce(new Error("down"));
    renderPanel();

    expect(
      await screen.findByText("The edit log could not be loaded.")
    ).toBeTruthy();
    expect(screen.queryByText("No edits yet.")).toBeNull();
  });

  it("keeps the loaded log when a later reread fails", async () => {
    server.listInventoryItemEditLog.mockResolvedValueOnce({
      rows: [row],
    } as never);
    const view = renderPanel();
    expect(await screen.findByText(/Grace Hopper/u)).toBeTruthy();
    server.listInventoryItemEditLog.mockRejectedValueOnce(new Error("down"));

    await view.queryClient.refetchQueries({
      queryKey: ["inventory-item", "item-1", "edit-log"],
    });

    await waitFor(() =>
      expect(server.listInventoryItemEditLog).toHaveBeenCalledTimes(2)
    );
    expect(screen.getByText(/Grace Hopper/u)).toBeTruthy();
    expect(screen.queryByText("The edit log could not be loaded.")).toBeNull();
  });

  it("reads the log again on a revisit, even inside the client's 30-second window", async () => {
    // The only writer is the edit page, which invalidates nothing here, so a
    // return from it must read again rather than show the cached log.
    const view = renderPanel();
    view.queryClient.setDefaultOptions({
      queries: { retry: false, staleTime: 30_000 },
    });
    expect(await screen.findByText("No edits yet.")).toBeTruthy();
    server.listInventoryItemEditLog.mockResolvedValueOnce({
      rows: [row],
    } as never);

    // A new key remounts the panel on the same client, as a revisit does.
    view.rerender(panel({}, "again"));

    expect(await screen.findByText(/Grace Hopper/u)).toBeTruthy();
  });
});
