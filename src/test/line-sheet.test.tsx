// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { LineSheet } from "#/components/line-sheet";
import type { TimelineEvent } from "#/lib/inventory-timeline";

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

afterEach(cleanup);

const events: TimelineEvent[] = [
  {
    actor: null,
    at: new Date("2026-09-01T10:00:00.000Z"),
    kind: "submitted",
    label: "Submitted",
    note: null,
  },
  {
    actor: "Staff A",
    at: new Date("2026-09-02T10:00:00.000Z"),
    kind: "decided",
    label: "Approved",
    note: null,
  },
  {
    actor: "Staff B",
    at: new Date("2026-09-10T10:00:00.000Z"),
    kind: "closed",
    label: "Rejected",
    note: "Out of scope this term",
  },
];

function renderSheet(open = true) {
  return render(
    <LineSheet
      actions={<button type="button">Approve</button>}
      description="Requested by Sam Lee"
      events={events}
      fields={[
        { label: "Item", value: "Oscilloscope" },
        { label: "Status", value: "Pending" },
      ]}
      onOpenChange={vi.fn()}
      open={open}
      title="Oscilloscope"
    />
  );
}

describe("LineSheet", () => {
  it("names the dialog by its title and describes it", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog", { name: "Oscilloscope" });
    expect(dialog.textContent).toContain("Requested by Sam Lee");
  });

  it("lists the fields as a definition list", () => {
    renderSheet();
    const dialog = screen.getByRole("dialog");
    const terms = [...dialog.querySelectorAll("dt")].map(
      (dt) => dt.textContent
    );
    const values = [...dialog.querySelectorAll("dd")].map(
      (dd) => dd.textContent
    );
    expect(terms).toEqual(["Item", "Status"]);
    expect(values).toEqual(["Oscilloscope", "Pending"]);
  });

  it("draws one timeline entry per event, with the actor and note when set", () => {
    renderSheet();
    const list = screen.getByRole("list", { name: "Timeline" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain("Submitted");
    expect(items[0].textContent).not.toContain("by ");
    expect(items[1].textContent).toContain("Approved");
    expect(items[1].textContent).toContain("by Staff A");
    expect(items[2].textContent).toContain("Rejected");
    expect(items[2].textContent).toContain("by Staff B");
    expect(items[2].textContent).toContain("Out of scope this term");
  });

  it("renders the actions", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Approve" })).toBeDefined();
  });

  it("renders nothing while closed", () => {
    renderSheet(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
