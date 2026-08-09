// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Radix Popover (Floating UI) and cmdk rely on a few DOM APIs jsdom omits.
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

vi.mock("#/server/users", () => ({
  searchUsers: vi.fn(),
}));

import { ProposerPicker } from "#/components/proposer-picker";
import { searchUsers } from "#/server/users";

const mockedSearch = vi.mocked(searchUsers);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// A minimal controlled wrapper standing in for the real form: ProposerPicker
// does not own `value`, so exercising a change requires feeding onChange's
// result back in, the way project-form.tsx does via TanStack Form.
function ControlledProposerPicker({
  accountLinked,
  accountName,
  initialValue,
}: {
  accountLinked: boolean;
  accountName: string | null;
  initialValue: string;
}) {
  const [value, setValue] = useState(initialValue);
  return (
    <ProposerPicker
      accountLinked={accountLinked}
      accountName={accountName}
      onChange={setValue}
      value={value}
    />
  );
}

describe("ProposerPicker", () => {
  it("renders the email value and lets you type a new one", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <ProposerPicker
        accountLinked={false}
        accountName={null}
        onChange={onChange}
        value="known@example.edu"
      />
    );
    const input = getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.value).toBe("known@example.edu");
    fireEvent.change(input, { target: { value: "new@example.edu" } });
    expect(onChange).toHaveBeenCalledWith("new@example.edu");
  });

  it("fills the email from a selected search result", async () => {
    mockedSearch.mockResolvedValue([
      { id: "u1", name: "Pat Lee", email: "pat@example.edu" },
    ] as never);
    const onChange = vi.fn();
    const { getByText, getByPlaceholderText, findByText } = render(
      <ProposerPicker
        accountLinked={false}
        accountName={null}
        onChange={onChange}
        value=""
      />
    );
    fireEvent.click(getByText("Find account"));
    fireEvent.change(getByPlaceholderText("Search accounts..."), {
      target: { value: "pat" },
    });
    fireEvent.click(await findByText(/pat@example.edu/));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("pat@example.edu")
    );
  });

  it("selects a result by keyboard (ArrowDown then Enter)", async () => {
    mockedSearch.mockResolvedValue([
      { id: "u1", name: "Pat Lee", email: "pat@example.edu" },
    ] as never);
    const onChange = vi.fn();
    const { getByText, getByPlaceholderText, findByText } = render(
      <ProposerPicker
        accountLinked={false}
        accountName={null}
        onChange={onChange}
        value=""
      />
    );
    fireEvent.click(getByText("Find account"));
    const search = getByPlaceholderText("Search accounts...");
    fireEvent.change(search, { target: { value: "pat" } });
    await findByText(/pat@example.edu/);
    fireEvent.keyDown(search, { key: "ArrowDown" });
    fireEvent.keyDown(search, { key: "Enter" });
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("pat@example.edu")
    );
  });
});

describe("ProposerPicker when an account is linked", () => {
  it("locks the field and offers Re-assign instead of Find account", () => {
    const { getByLabelText, getByText, queryByText } = render(
      <ProposerPicker
        accountLinked
        accountName="Alex Kim"
        onChange={vi.fn()}
        value="alex@oregonstate.edu"
      />
    );

    const input = getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(getByText("Re-assign")).toBeTruthy();
    expect(queryByText("Find account")).toBeNull();
  });

  it("names the linked account so staff know who they would displace", () => {
    const { getByText } = render(
      <ProposerPicker
        accountLinked
        accountName="Alex Kim"
        onChange={vi.fn()}
        value="alex@oregonstate.edu"
      />
    );

    expect(getByText(/Alex Kim/)).toBeTruthy();
  });

  it("re-assigns to a selected account", async () => {
    mockedSearch.mockResolvedValue([
      { email: "jo@oregonstate.edu", id: "u2", name: "Jo Diaz" },
    ] as never);
    const onChange = vi.fn();
    const { getByText, getByPlaceholderText } = render(
      <ProposerPicker
        accountLinked
        accountName="Alex Kim"
        onChange={onChange}
        value="alex@oregonstate.edu"
      />
    );

    fireEvent.click(getByText("Re-assign"));
    fireEvent.change(getByPlaceholderText("Search accounts..."), {
      target: { value: "jo" },
    });
    await waitFor(() => getByText("Jo Diaz"));
    fireEvent.click(getByText("Jo Diaz"));

    expect(onChange).toHaveBeenCalledWith("jo@oregonstate.edu");
  });

  it("unlinks to an external proposer", () => {
    const onChange = vi.fn();
    const { getByText } = render(
      <ProposerPicker
        accountLinked
        accountName="Alex Kim"
        onChange={onChange}
        value="alex@oregonstate.edu"
      />
    );

    fireEvent.click(getByText("Re-assign"));
    fireEvent.click(getByText("Remove the link and set an external proposer"));

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("leaves the field editable when no account is linked", () => {
    const { getByLabelText, getByText } = render(
      <ProposerPicker
        accountLinked={false}
        accountName={null}
        onChange={vi.fn()}
        value="outsider@example.com"
      />
    );

    const input = getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.readOnly).toBe(false);
    expect(getByText("Find account")).toBeTruthy();
  });
});

describe("ProposerPicker when the on-screen value has diverged from the saved link", () => {
  it("unlocks and stops naming the old account after re-assigning through the modal", async () => {
    mockedSearch.mockResolvedValue([
      { email: "jo@oregonstate.edu", id: "u2", name: "Jo Diaz" },
    ] as never);
    const { getByLabelText, getByText, getByPlaceholderText, queryByText } =
      render(
        <ControlledProposerPicker
          accountLinked
          accountName="Alex Kim"
          initialValue="alex@oregonstate.edu"
        />
      );

    fireEvent.click(getByText("Re-assign"));
    fireEvent.change(getByPlaceholderText("Search accounts..."), {
      target: { value: "jo" },
    });
    await waitFor(() => getByText("Jo Diaz"));
    fireEvent.click(getByText("Jo Diaz"));

    const input = getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe("jo@oregonstate.edu");
    expect(queryByText(/Alex Kim/)).toBeNull();
    expect(getByText(/will be re-assigned to jo@oregonstate.edu/)).toBeTruthy();
  });

  it("unlocks and can be typed into after unlinking, and says the link will be removed", () => {
    const { getByLabelText, getByText } = render(
      <ControlledProposerPicker
        accountLinked
        accountName="Alex Kim"
        initialValue="alex@oregonstate.edu"
      />
    );

    fireEvent.click(getByText("Re-assign"));
    fireEvent.click(getByText("Remove the link and set an external proposer"));

    const input = getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.readOnly).toBe(false);
    expect(input.value).toBe("");
    expect(getByText(/link will be removed when saved/)).toBeTruthy();

    fireEvent.change(input, { target: { value: "outsider@example.com" } });
    expect(input.value).toBe("outsider@example.com");
  });

  it("leaves a never-linked project unaffected", () => {
    const { getByLabelText, getByText } = render(
      <ControlledProposerPicker
        accountLinked={false}
        accountName={null}
        initialValue="outsider@example.com"
      />
    );

    const input = getByLabelText("Proposer email") as HTMLInputElement;
    expect(input.readOnly).toBe(false);
    expect(getByText("Find account")).toBeTruthy();

    fireEvent.change(input, { target: { value: "someone-else@example.com" } });
    expect(input.value).toBe("someone-else@example.com");
    expect(input.readOnly).toBe(false);
    expect(getByText("Find account")).toBeTruthy();
  });
});
