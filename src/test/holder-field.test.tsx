// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("#/server/users", () => ({
  lookupUserByEmail: vi.fn(),
  searchUsers: vi.fn(),
}));

import { HolderField } from "#/components/holder-field";
import { lookupUserByEmail, searchUsers } from "#/server/users";

const mockedLookup = vi.mocked(lookupUserByEmail);
const mockedSearch = vi.mocked(searchUsers);

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
      onAccountStatusChange={noop}
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

    const onAccountStatusChange = vi.fn();
    renderField({ email: "ada@x.test", onAccountStatusChange });

    expect(
      await screen.findByText(/Matches account: Ada Lovelace/)
    ).toBeTruthy();
    expect(screen.queryByLabelText(/^name$/i)).toBeNull();
    expect(screen.queryByLabelText(/program/i)).toBeNull();
    expect(onAccountStatusChange).toHaveBeenCalledWith("matched");
  });

  it("reports unknown synchronously and settles to the resolved answer", async () => {
    resolvesTo(null);
    const onAccountStatusChange = vi.fn();
    renderField({ email: "someone@nowhere.test", onAccountStatusChange });
    // Synchronous first report, so a confirm during the debounce window can
    // never be treated as "this address has no account".
    expect(onAccountStatusChange).toHaveBeenCalledWith("unknown");
    await waitFor(() =>
      expect(onAccountStatusChange).toHaveBeenCalledWith("unmatched")
    );
  });
});
