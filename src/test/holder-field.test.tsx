// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { installResizeObserver } from "./radix-jsdom";

vi.mock("#/server/users", () => ({
  lookupUserByEmail: vi.fn(),
  searchUsers: vi.fn(),
}));

import { HolderField } from "#/components/holder-field";
import { lookupUserByEmail, searchUsers } from "#/server/users";

const mockedLookup = vi.mocked(lookupUserByEmail);
const mockedSearch = vi.mocked(searchUsers);

// The account search is a Radix Popover around a cmdk list; both read DOM
// APIs jsdom omits. Same stub set as proposer-picker.test.tsx.
beforeAll(() => {
  installResizeObserver();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  mockedLookup.mockReset();
  mockedSearch.mockReset();
});

const noop = () => {
  // no-op
};

/** The account-lookup result the debounced effect will settle on. */
function resolvesTo(
  account: { email: string; id: string; name: string | null } | null
) {
  mockedLookup.mockResolvedValue(account as never);
}

function renderField(overrides: Partial<Parameters<typeof HolderField>[0]>) {
  return render(
    <HolderField
      email=""
      label=""
      name=""
      onEmailChange={noop}
      onLabelChange={noop}
      onNameChange={noop}
      onProgramChange={noop}
      program=""
      {...overrides}
    />
  );
}

describe("HolderField", () => {
  it("asks for a label only when the email is blank", () => {
    resolvesTo(null);
    renderField({});
    expect(screen.getByLabelText(/label/i)).toBeTruthy();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
  });

  it("hides the label field once an address is typed", () => {
    resolvesTo(null);
    renderField({ email: "someone@nowhere.test" });
    expect(screen.queryByLabelText(/label/i)).toBeNull();
  });

  it("keeps name and program closed while the account lookup is pending", () => {
    // The regression this guards: the fields used to render on the first
    // paint, because "no account yet" and "no account" were the same state.
    // A dialog opened on a request whose requester has an account therefore
    // flashed them open and shut.
    resolvesTo({ email: "ada@x.test", id: "u1", name: "Ada" });
    renderField({ email: "ada@x.test" });
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
    expect(screen.queryByLabelText(/program/i)).toBeNull();
  });

  it("offers name and program once the lookup finds no account", async () => {
    resolvesTo(null);
    renderField({ email: "someone@nowhere.test" });
    expect(await screen.findByLabelText(/^name$/i)).toBeTruthy();
    expect(screen.getByLabelText(/program/i)).toBeTruthy();
  });

  it("names the matched account and never opens the fields", async () => {
    resolvesTo({ email: "ada@x.test", id: "u1", name: "Ada Lovelace" });
    renderField({ email: "ada@x.test" });
    expect(
      await screen.findByText(/Matches account: Ada Lovelace/)
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
  });

  it("recognises an account the search endpoint's result window drops", async () => {
    // The defect: existence was decided from search results, which are
    // ordered and capped, so a real account outside the window read as a
    // walk-in and the dialog offered Name and Program for someone who has
    // an account. Search returning nothing here stands in for that window.
    mockedSearch.mockResolvedValue([] as never);
    resolvesTo({ email: "ada@x.test", id: "u1", name: "Ada Lovelace" });

    renderField({ email: "ada@x.test" });

    expect(
      await screen.findByText(/Matches account: Ada Lovelace/)
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
    expect(screen.queryByLabelText(/program/i)).toBeNull();
  });

  it("opens the account search on demand and fills the address from a pick", async () => {
    resolvesTo(null);
    mockedSearch.mockResolvedValue([
      { email: "ada@x.test", id: "u1", name: "Ada Lovelace" },
    ] as never);
    const onEmailChange = vi.fn();
    renderField({ onEmailChange });

    // Closed until asked: the search list is not part of the form.
    expect(
      screen.queryByPlaceholderText("Search by name or email...")
    ).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Search accounts" }));
    fireEvent.change(
      await screen.findByPlaceholderText("Search by name or email..."),
      { target: { value: "ada" } }
    );
    await waitFor(() => expect(screen.getByText("Ada Lovelace")).toBeTruthy());
    expect(mockedSearch).toHaveBeenCalledWith({ data: { q: "ada" } });

    fireEvent.click(screen.getByText("Ada Lovelace"));
    expect(onEmailChange).toHaveBeenCalledWith("ada@x.test");
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText("Search by name or email...")
      ).toBeNull()
    );
  });

  it("keeps the inputs closed until the lookup answers, then opens them", async () => {
    // The status is local now, so this asserts what a user sees rather than a
    // callback: nothing flashes open during the debounce window, and the
    // walk-in fields appear once the address is known to have no account.
    resolvesTo(null);
    renderField({ email: "someone@nowhere.test" });
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
    await waitFor(() => expect(screen.getByLabelText(/^name$/i)).toBeTruthy());
    expect(screen.getByLabelText(/program/i)).toBeTruthy();
  });
});
