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
import type { ItemStatus } from "#/lib/vocabularies";

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
vi.mock("@tanstack/react-router", () => ({ useRouter: () => router }));

import { InventoryLifecyclePanel } from "#/components/inventory-lifecycle-panel";
import {
  HARD_DELETE_HISTORY_REFUSAL,
  needsHolder,
} from "#/lib/inventory-workflow";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const STATUSES: ItemStatus[] = [
  "available",
  "requested",
  "reserved",
  "checked_out",
  "maintenance",
  "retired",
];

function renderPanel(
  overrides: { status?: ItemStatus; hasRequestHistory?: boolean } = {}
) {
  return render(
    <InventoryLifecyclePanel
      hasRequestHistory={overrides.hasRequestHistory ?? false}
      history={[]}
      item={{
        id: "item-1",
        name: "Oscilloscope",
        status: overrides.status ?? "available",
        currentHolderId: null,
        currentHolderLabel: null,
        currentRequestItemId: null,
      }}
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

  it.each(
    cases
  )("offers hard delete for $status with request history $hasRequestHistory only when both allow it", ({
    status,
    hasRequestHistory,
  }) => {
    renderPanel({ status, hasRequestHistory });
    const allowed =
      (status === "available" || status === "retired") && !hasRequestHistory;
    expect(hardDeleteTrigger()).toHaveProperty("disabled", !allowed);
  });

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
  )("$status offers $label, and asks who holds the item exactly when the rules say the target needs a holder", async ({
    status,
    label,
    next,
  }) => {
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
  });
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
      await screen.findByRole("option", { name: next.replace(/_/g, " ") })
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
  )("overriding to $next asks who holds the item exactly when the rules say the target needs a holder", async ({
    next,
  }) => {
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
  });

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
