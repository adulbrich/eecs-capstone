// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
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

describe("ProposerPicker", () => {
  it("renders the email value and lets you type a new one", () => {
    const onChange = vi.fn();
    const { getByLabelText } = render(
      <ProposerPicker onChange={onChange} value="known@example.edu" />
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
      <ProposerPicker onChange={onChange} value="" />
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
      <ProposerPicker onChange={onChange} value="" />
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
