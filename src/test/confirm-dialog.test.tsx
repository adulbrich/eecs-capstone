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
      <Button variant="destructive">Delete</Button>
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
