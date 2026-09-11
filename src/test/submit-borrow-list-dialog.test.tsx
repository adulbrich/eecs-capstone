// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { SubmitBorrowListDialog } from "#/components/submit-borrow-list-dialog";

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

describe("SubmitBorrowListDialog", () => {
  it("collects the note and hands it over, then closes", async () => {
    const onSubmit = vi.fn();
    render(
      <SubmitBorrowListDialog busy={false} count={2} onSubmit={onSubmit} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      screen.getByRole("dialog", { name: "Submit 2 items as one request" })
    ).toBeDefined();
    fireEvent.change(screen.getByLabelText("Note for staff (optional)"), {
      target: { value: "For the demo rig" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSubmit).toHaveBeenCalledWith("For the demo rig");
  });

  it("sends null rather than an empty note", async () => {
    const onSubmit = vi.fn();
    render(
      <SubmitBorrowListDialog busy={false} count={1} onSubmit={onSubmit} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    fireEvent.click(screen.getByRole("button", { name: "Submit request" }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith(null));
  });

  it("closes on Cancel without submitting, and keeps the typed note", async () => {
    const onSubmit = vi.fn();
    render(
      <SubmitBorrowListDialog busy={false} count={1} onSubmit={onSubmit} />
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    fireEvent.change(screen.getByLabelText("Note for staff (optional)"), {
      target: { value: "Half typed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onSubmit).not.toHaveBeenCalled();

    // Only a successful submit clears the note, so a Cancel is a pause rather
    // than a discard.
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(
      (
        screen.getByLabelText(
          "Note for staff (optional)"
        ) as HTMLTextAreaElement
      ).value
    ).toBe("Half typed");
  });

  it("is disabled while the page is busy", () => {
    render(<SubmitBorrowListDialog busy={true} count={1} onSubmit={vi.fn()} />);
    expect(
      (screen.getByRole("button", { name: "Submit" }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
  });
});
