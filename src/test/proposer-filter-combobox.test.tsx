// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ProposerFilterCombobox } from "#/components/proposer-filter-combobox";
import { installResizeObserver } from "./radix-jsdom";

// Radix Popover (Floating UI) and cmdk rely on a few DOM APIs jsdom omits.
beforeAll(() => {
  installResizeObserver();
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn();
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(cleanup);

const PROPOSERS = [
  { email: "reid@oregonstate.edu", id: "u1", name: "Dana Reid" },
  { email: "tanaka@oregonstate.edu", id: "u2", name: "Aiko Tanaka" },
  { email: "vo@example.org", id: "u3", name: "Chris Vo" },
];

function open(value: string | null = null) {
  const onChange = vi.fn();
  render(
    <ProposerFilterCombobox
      id="proposer"
      onChange={onChange}
      proposers={PROPOSERS}
      value={value}
    />
  );
  fireEvent.click(screen.getByRole("combobox"));
  return onChange;
}

function type(query: string) {
  fireEvent.change(screen.getByPlaceholderText("Search name or email"), {
    target: { value: query },
  });
}

describe("ProposerFilterCombobox", () => {
  it("narrows the list by a fragment of the name", async () => {
    open();
    type("tanak");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("Aiko Tanaka");
  });

  it("narrows the list by a fragment of the address, which the select could not do", async () => {
    open();
    type("vo@example");
    const options = await screen.findAllByRole("option");
    expect(options).toHaveLength(1);
    expect(options[0].textContent).toContain("vo@example.org");
  });

  it("does not match an address that only contains the query's letters in order", async () => {
    open();
    // cmdk's own scorer reads "acme" out of grace.kim@oregonstate.edu.
    type("acme");
    expect(await screen.findByText("No proposer matches.")).toBeTruthy();
  });

  it("reports a query that matches nobody", async () => {
    open();
    type("nobody@nowhere.test");
    expect(await screen.findByText("No proposer matches.")).toBeTruthy();
  });

  it("hands back the chosen proposer's id", async () => {
    const onChange = open();
    fireEvent.click(await screen.findByText("Dana Reid"));
    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("clears the filter from All proposers", async () => {
    const onChange = open("u1");
    fireEvent.click(await screen.findByText("All proposers"));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("names the chosen proposer on the trigger", () => {
    render(
      <ProposerFilterCombobox
        id="proposer"
        onChange={vi.fn()}
        proposers={PROPOSERS}
        value="u1"
      />
    );
    expect(screen.getByRole("combobox").textContent).toContain(
      "Dana Reid (reid@oregonstate.edu)"
    );
  });

  it("still reports a proposer chosen outside the current filters", () => {
    render(
      <ProposerFilterCombobox
        id="proposer"
        onChange={vi.fn()}
        proposers={PROPOSERS}
        value="someone-filtered-out"
      />
    );
    expect(screen.getByRole("combobox").textContent).toContain(
      "Selected proposer (outside current filters)"
    );
  });
});
