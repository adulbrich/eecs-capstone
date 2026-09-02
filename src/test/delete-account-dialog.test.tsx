// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({
  // `to` becomes `href`, so the anchor carries the link role and the test
  // can assert where it points.
  Link: ({
    children,
    to,
    ...rest
  }: { children: React.ReactNode; to: string } & Record<string, unknown>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

const { deleteAccount } = vi.hoisted(() => ({ deleteAccount: vi.fn() }));
vi.mock("#/server/account", () => ({ deleteAccount }));

import {
  DeleteAccountDialog,
  type DeletionPreview,
} from "#/components/delete-account-dialog";

afterEach(cleanup);
beforeEach(() => {
  deleteAccount.mockReset();
  deleteAccount.mockResolvedValue({ ok: true });
});

const EMAIL = "Person@Example.edu";

function clear(overrides: Partial<DeletionPreview> = {}): DeletionPreview {
  return {
    blockers: { items: [], lastAdmin: false },
    email: EMAIL,
    programs: [],
    ...overrides,
  };
}

function open(preview: DeletionPreview | null) {
  const onDeleted = vi.fn();
  render(<DeleteAccountDialog onDeleted={onDeleted} preview={preview} />);
  fireEvent.click(screen.getByRole("button", { name: "Delete account" }));
  return onDeleted;
}

describe("DeleteAccountDialog", () => {
  it("states every promise before it acts", () => {
    open(clear());
    const text = document.body.textContent ?? "";
    for (const promise of [
      "Your projects stay published",
      'becomes "Deleted user"',
      "Contact details you typed into a project stay",
      "Records of inventory you borrowed stay",
      "cannot be undone",
      "we cannot link your old projects back",
    ]) {
      expect(text).toContain(promise);
    }
  });

  it("names the programs the person will disappear from, only when there are any", () => {
    open(
      clear({
        programs: [
          { courseId: "CS 461", courseName: "Capstone I", id: "p1" },
          { courseId: "CS 462", courseName: "Capstone II", id: "p2" },
        ],
      })
    );
    const text = document.body.textContent ?? "";
    expect(text).toContain("You will be removed from these programs");
    expect(text).toContain("CS 461 Capstone I");
    expect(text).toContain("CS 462 Capstone II");
    cleanup();
    open(clear());
    expect(document.body.textContent).not.toContain(
      "You will be removed from these programs"
    );
  });

  it("enables the destructive action only once the typed email matches, case-insensitively", async () => {
    open(clear());
    const confirm = screen.getByRole("button", { name: "Delete my account" });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    const input = screen.getByLabelText("Confirm email");
    fireEvent.change(input, { target: { value: "wrong@example.edu" } });
    expect(confirm.hasAttribute("disabled")).toBe(true);

    fireEvent.change(input, { target: { value: "person@example.edu" } });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(deleteAccount).toHaveBeenCalledWith({
        data: { confirmEmail: "person@example.edu" },
      })
    );
  });

  it("calls onDeleted after a successful delete and reports a failed one", async () => {
    const onDeleted = open(clear());
    fireEvent.change(screen.getByLabelText("Confirm email"), {
      target: { value: EMAIL },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));

    cleanup();
    deleteAccount.mockRejectedValue(new Error("Account has outstanding items"));
    const second = open(clear());
    fireEvent.change(screen.getByLabelText("Confirm email"), {
      target: { value: EMAIL },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete my account" }));
    expect(
      await screen.findByText("Account has outstanding items")
    ).toBeTruthy();
    expect(second).not.toHaveBeenCalled();
  });

  it("shows the block and no gate while an item is out", () => {
    open(
      clear({
        blockers: {
          items: [{ id: "i1", name: "Oscilloscope" }],
          lastAdmin: false,
        },
      })
    );
    expect(document.body.textContent).toContain("Oscilloscope");
    expect(
      screen.getByRole("link", { name: /my items/i }).getAttribute("href")
    ).toBe("/my/items");
    expect(screen.queryByLabelText("Confirm email")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Delete my account" })
    ).toBeNull();
  });

  it("shows the last-admin block", () => {
    open(clear({ blockers: { items: [], lastAdmin: true } }));
    expect(document.body.textContent).toContain("only admin");
    expect(screen.queryByLabelText("Confirm email")).toBeNull();
  });

  it("keeps the trigger disabled until the preview has loaded", () => {
    render(<DeleteAccountDialog onDeleted={() => undefined} preview={null} />);
    expect(
      screen
        .getByRole("button", { name: "Delete account" })
        .hasAttribute("disabled")
    ).toBe(true);
  });
});
