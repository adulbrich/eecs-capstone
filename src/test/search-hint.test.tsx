// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SearchHint, SearchQueryNote } from "#/components/search-hint";
import { SEARCH_QUERY_MAX } from "#/lib/search-query";

afterEach(cleanup);

describe("SearchHint", () => {
  it("names the fields and carries the syntax sentence under the given id", () => {
    // The syntax claim is the component's, the fields are the caller's: a
    // route cannot ship a hint that forgets to say how phrases and
    // exclusions work, and cannot restate it differently (#369).
    render(<SearchHint fields="names and descriptions" id="hint" />);
    const hint = screen.getByText(/Searches names and descriptions\./);
    expect(hint.id).toBe("hint");
    expect(hint.textContent).toMatch(
      /Quote a "phrase", or put - before a word to exclude it\./
    );
  });

  it("describes an input that names it", () => {
    render(
      <>
        <input aria-describedby="hint" aria-label="Search" type="search" />
        <SearchHint fields="titles" id="hint" />
      </>
    );
    // No jest-dom here: the described-by chain is checked by hand, the way
    // the browser suites then confirm it through the accessibility tree.
    const box = screen.getByRole("searchbox", { name: "Search" });
    const described = document.getElementById(
      box.getAttribute("aria-describedby") ?? ""
    );
    expect(described?.textContent).toMatch(/Searches titles\./);
  });

  // The note the server's clamp owes the reader (#478). In the described
  // paragraph rather than a live region, so a screen reader hears it when it
  // reaches the box that produced it.
  it("says nothing about length for a query inside the cap", () => {
    render(
      <SearchHint
        fields="titles"
        id="hint"
        query={"a".repeat(SEARCH_QUERY_MAX)}
      />
    );
    expect(screen.getByText(/Searches titles\./).textContent).not.toMatch(
      /characters were used/
    );
  });

  it("says the query was cut when it was", () => {
    render(
      <SearchHint
        fields="titles"
        id="hint"
        query={"a".repeat(SEARCH_QUERY_MAX + 1)}
      />
    );
    expect(screen.getByText(/Searches titles\./).textContent).toMatch(
      new RegExp(`only its first ${SEARCH_QUERY_MAX} characters were used`)
    );
  });

  it("stays silent when the caller passes no query", () => {
    // Every caller passes one today; the prop is optional so a listing that
    // does not can still render the hint.
    render(<SearchHint fields="titles" id="hint" />);
    expect(screen.getByText(/Searches titles\./).textContent).not.toMatch(
      /characters were used/
    );
  });
});

describe("SearchQueryNote", () => {
  // The three staff tables with a bare input and no hint render this one
  // instead, so the sentence and the margin have one home (#478).
  it("renders nothing for a query inside the cap", () => {
    const { container } = render(
      <SearchQueryNote id="note" query={"a".repeat(SEARCH_QUERY_MAX)} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders the note under the id the input describes itself by", () => {
    render(
      <SearchQueryNote id="note" query={"a".repeat(SEARCH_QUERY_MAX + 1)} />
    );
    const note = screen.getByText(/characters were used/);
    expect(note.id).toBe("note");
    expect(note.tagName).toBe("P");
  });
});
