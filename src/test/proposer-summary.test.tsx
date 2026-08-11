// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ProposerSummary } from "#/components/proposer-summary";

afterEach(cleanup);

describe("ProposerSummary", () => {
  it("names the account holder when one is linked", () => {
    const { getByText } = render(
      <ProposerSummary
        proposer={{
          accountLinked: true,
          accountName: "Jane Doe",
          email: "jane@oregonstate.edu",
        }}
      />
    );
    expect(getByText("Jane Doe")).toBeTruthy();
    expect(getByText("jane@oregonstate.edu")).toBeTruthy();
    expect(getByText("Account linked")).toBeTruthy();
  });

  it("says an address has no account yet", () => {
    // The state that matters. An unlinked proposer gets no "My projects"
    // entry, no status notifications and no review emails, so staff need to
    // see that this person is receiving nothing.
    const { getByText, queryByText } = render(
      <ProposerSummary
        proposer={{
          accountLinked: false,
          accountName: null,
          email: "jane@x.com",
        }}
      />
    );
    expect(getByText("jane@x.com")).toBeTruthy();
    expect(getByText("No account yet")).toBeTruthy();
    expect(queryByText("Account linked")).toBeNull();
  });

  it("says none on file when there is no address at all", () => {
    const { getByText, queryByText } = render(
      <ProposerSummary
        proposer={{ accountLinked: false, accountName: null, email: "" }}
      />
    );
    expect(getByText("None on file")).toBeTruthy();
    expect(queryByText("No account yet")).toBeNull();
  });
});
