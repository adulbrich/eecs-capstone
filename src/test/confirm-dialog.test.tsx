// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "#/components/confirm-dialog";
import { Button } from "#/components/ui/button";

afterEach(cleanup);

function setup(onConfirm: () => void) {
  return render(
    <ConfirmDialog
      description="This cannot be undone."
      onConfirm={onConfirm}
      title="Permanently delete this draft?"
    >
      <Button type="button" variant="destructive">
        Delete
      </Button>
    </ConfirmDialog>
  );
}

describe("ConfirmDialog", () => {
  it("does not run the action until the user confirms", async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    await screen.findByRole("alertdialog");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("runs the action on confirm", async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    // The dialog's own Delete, not the trigger. Both carry the same label.
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Delete" })
    );
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
  });

  it("does not run the action on cancel", async () => {
    const onConfirm = vi.fn();
    setup(onConfirm);
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await userEvent.click(
      within(dialog).getByRole("button", { name: "Cancel" })
    );
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(onConfirm).not.toHaveBeenCalled();
  });

  /**
   * The contract #410 gave it: the dialog owns the flight, so a caller's
   * handler does the work and lets the error out. Before this, `onConfirm` was
   * called without being awaited and the action closed the dialog on click, so
   * a refusal landed in a paragraph on the page behind it.
   */
  describe("while the action is in flight", () => {
    function setupDeferred() {
      let settle: (value?: unknown) => void = () => undefined;
      let reject: (reason: unknown) => void = () => undefined;
      const onConfirm = vi.fn(
        () =>
          new Promise<void>((res, rej) => {
            settle = res as () => void;
            reject = rej;
          })
      );
      render(
        <ConfirmDialog
          description="This cannot be undone."
          onConfirm={onConfirm}
          title="Permanently delete this draft?"
        >
          <Button type="button" variant="destructive">
            Delete
          </Button>
        </ConfirmDialog>
      );
      // Both wrapped, so they read the binding the executor assigned rather
      // than the placeholder that existed when this returned.
      return {
        onConfirm,
        settle: () => settle(),
        reject: (reason: unknown) => reject(reason),
      };
    }

    async function openAndConfirm() {
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      const dialog = await screen.findByRole("alertdialog");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Delete" })
      );
      return dialog;
    }

    it("disables its action and says what it is doing", async () => {
      const { settle } = setupDeferred();
      const dialog = await openAndConfirm();
      const busy = await within(dialog).findByRole("button", {
        name: "Deleting...",
      });
      expect(busy).toBeDisabled();
      expect(
        within(dialog).getByRole("button", { name: "Cancel" })
      ).toBeDisabled();
      settle();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("cannot be started twice", async () => {
      const { onConfirm, settle } = setupDeferred();
      const dialog = await openAndConfirm();
      const busy = await within(dialog).findByRole("button", {
        name: "Deleting...",
      });
      await userEvent.click(busy, { pointerEventsCheck: 0 });
      await userEvent.click(busy, { pointerEventsCheck: 0 });
      expect(onConfirm).toHaveBeenCalledTimes(1);
      settle();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("closes only when the action resolves", async () => {
      const { settle } = setupDeferred();
      await openAndConfirm();
      expect(screen.getByRole("alertdialog")).toBeTruthy();
      settle();
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    });

    it("stays open and shows the refusal inside itself", async () => {
      const { reject } = setupDeferred();
      const dialog = await openAndConfirm();
      reject(new Error("Cannot delete the last one"));
      expect(
        await within(dialog).findByText("Cannot delete the last one")
      ).toBeTruthy();
      expect(screen.getByRole("alertdialog")).toBeTruthy();
      // Announced, like every other failure (#411).
      expect(within(dialog).getByRole("alert").textContent).toBe(
        "Cannot delete the last one"
      );
      // And usable again, rather than stuck busy.
      expect(
        within(dialog).getByRole("button", { name: "Delete" })
      ).not.toBeDisabled();
    });

    // A server function can reject with anything, and `errorMessage` exists
    // because an empty one used to render an empty paragraph.
    it("has a message even when the rejection carries none", async () => {
      const { reject } = setupDeferred();
      const dialog = await openAndConfirm();
      reject({ status: 500 });
      expect(
        await within(dialog).findByText(
          "Something went wrong. Please try again."
        )
      ).toBeTruthy();
    });

    it("forgets a refusal when the dialog is reopened", async () => {
      const { reject } = setupDeferred();
      const dialog = await openAndConfirm();
      reject(new Error("Cannot delete the last one"));
      await within(dialog).findByText("Cannot delete the last one");
      await userEvent.click(
        within(dialog).getByRole("button", { name: "Cancel" })
      );
      await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
      await userEvent.click(screen.getByRole("button", { name: "Delete" }));
      const reopened = await screen.findByRole("alertdialog");
      expect(
        within(reopened).queryByText("Cannot delete the last one")
      ).toBeNull();
    });
  });

  it("names itself with the title and describes itself with the description", async () => {
    setup(vi.fn());
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    // This is the assertion that native confirm() could never satisfy: the
    // dialog carries its own accessible name and description.
    expect(dialog).toHaveAccessibleName("Permanently delete this draft?");
    expect(dialog).toHaveAccessibleDescription("This cannot be undone.");
  });
});
