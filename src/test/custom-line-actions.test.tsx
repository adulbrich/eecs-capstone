// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
    render(<CustomLineActions line={pending} onDone={vi.fn()} />);
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
    render(<CustomLineActions line={pending} onDone={onDone} />);
    fireEvent.click(screen.getByRole("button", { name: "Start sourcing" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm sourcing" }));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(startSourcingCustomLine).toHaveBeenCalledWith({
      data: { customLineId: "c-1", sourcingNote: null },
    });
  });

  it("refuses a rejection without a reason before it reaches the server", () => {
    render(<CustomLineActions line={pending} onDone={vi.fn()} />);
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
      />
    );
    expect(screen.queryByRole("button")).toBeNull();
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
});

describe("FulfillCustomLineDialog", () => {
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
    render(<FulfillCustomLineDialog line={pending} onDone={onDone} />);
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
      },
    });
  });

  it("refuses to confirm with nothing linked", () => {
    render(<FulfillCustomLineDialog line={pending} onDone={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Fulfil" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm fulfil" }));
    expect(screen.getByText("Link at least one item")).toBeDefined();
    expect(fulfillCustomLine).not.toHaveBeenCalled();
  });
});
