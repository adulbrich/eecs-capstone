// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SearchHint } from "#/components/search-hint";

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
});
