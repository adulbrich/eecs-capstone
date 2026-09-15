// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const { banUser, setUserRole, unbanUser } = vi.hoisted(() => ({
  banUser: vi.fn(),
  setUserRole: vi.fn(),
  unbanUser: vi.fn(),
}));
vi.mock("#/server/users", () => ({ banUser, setUserRole, unbanUser }));

// Radix Select and Dialog read a few DOM APIs jsdom omits. Same stub set as
// approve-all-dialog.test.tsx.
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

import { BanForm } from "#/components/ban-form";
import { RoleSelect } from "#/components/role-select";

afterEach(cleanup);
beforeEach(() => {
  banUser.mockReset();
  setUserRole.mockReset();
  banUser.mockResolvedValue({ id: "u1", banned: true });
  setUserRole.mockResolvedValue({ id: "u1", role: "instructor" });
});

const EMAIL = "person@example.edu";

describe("RoleSelect email skip (#386)", () => {
  function pickInstructor() {
    const trigger = screen.getByRole("combobox");
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "instructor" }));
  }

  it("confirms with the address named, and sends the choice", async () => {
    render(
      <RoleSelect
        email={EMAIL}
        initialRole="user"
        onChanged={() => {
          // no-op
        }}
        userId="u1"
      />
    );
    pickInstructor();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const dialog = within(
      screen.getByRole("dialog", { name: "Change the role?" })
    );
    expect(
      dialog.getByText(`Sets the role of ${EMAIL} to instructor.`)
    ).toBeTruthy();
    const box = dialog.getByRole("checkbox", { name: `Email ${EMAIL}` });
    expect(box.getAttribute("aria-checked")).toBe("true");
    expect(dialog.getByText("Uncheck and they will not be told.")).toBeTruthy();
    fireEvent.click(box);
    fireEvent.click(dialog.getByRole("button", { name: "Save role" }));

    await waitFor(() =>
      expect(setUserRole).toHaveBeenCalledWith({
        data: { userId: "u1", role: "instructor", sendEmail: false },
      })
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("BanForm email skip (#386)", () => {
  function renderForm() {
    return render(
      <BanForm
        banExpires={null}
        banned={false}
        banReason={null}
        email={EMAIL}
        onChanged={() => {
          // no-op
        }}
        userId="u1"
      />
    );
  }

  it("confirms through the destructive dialog, names the address, and sends the choice", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Repeated misuse" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ban" }));

    const dialog = within(
      screen.getByRole("alertdialog", { name: "Ban this user?" })
    );
    expect(
      dialog.getByText(
        `${EMAIL} is signed out now and cannot sign in until an admin unbans them.`
      )
    ).toBeTruthy();
    const box = dialog.getByRole("checkbox", { name: `Email ${EMAIL}` });
    expect(box.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(box);
    fireEvent.click(dialog.getByRole("button", { name: "Ban" }));

    await waitFor(() =>
      expect(banUser).toHaveBeenCalledWith({
        data: {
          userId: "u1",
          reason: "Repeated misuse",
          expiresAt: null,
          sendEmail: false,
        },
      })
    );
  });

  it("checks the box again after a Cancel", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Reason"), {
      target: { value: "Spam" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Ban" }));
    let dialog = within(
      screen.getByRole("alertdialog", { name: "Ban this user?" })
    );
    fireEvent.click(dialog.getByRole("checkbox", { name: `Email ${EMAIL}` }));
    fireEvent.click(dialog.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());

    fireEvent.click(screen.getByRole("button", { name: "Ban" }));
    dialog = within(
      screen.getByRole("alertdialog", { name: "Ban this user?" })
    );
    expect(
      dialog
        .getByRole("checkbox", { name: `Email ${EMAIL}` })
        .getAttribute("aria-checked")
    ).toBe("true");
    expect(banUser).not.toHaveBeenCalled();
  });
});
