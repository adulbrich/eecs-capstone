// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  Pagination,
  PaginationLink,
  PaginationStatus,
} from "#/components/ui/pagination";

afterEach(cleanup);

describe("Pagination", () => {
  it("labels itself as pagination navigation", () => {
    render(
      <Pagination>
        <PaginationStatus page={1} shown={20} total={47} totalPages={3} />
      </Pagination>
    );
    expect(screen.getByRole("navigation", { name: "Pagination" })).toBeTruthy();
  });

  it("takes a disabled link out of the tab order and marks it disabled", () => {
    // The actual bug: pointer-events-none stops the mouse and nothing else, so
    // a keyboard user could still focus and activate "Previous" on page 1.
    render(
      <Pagination>
        <PaginationLink disabled href="/projects?page=0">
          Previous
        </PaginationLink>
      </Pagination>
    );
    const previous = screen.getByText("Previous");
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    expect(previous.getAttribute("tabindex")).toBe("-1");
    expect(previous.hasAttribute("href")).toBe(false);
  });

  it("leaves an enabled link fully operable", () => {
    render(
      <Pagination>
        <PaginationLink href="/projects?page=2">Next</PaginationLink>
      </Pagination>
    );
    const next = screen.getByRole("link", { name: "Next" });
    expect(next.getAttribute("aria-disabled")).toBeNull();
    expect(next.getAttribute("tabindex")).toBeNull();
  });

  it("announces the position and the count politely on a multi-page list", () => {
    render(<PaginationStatus page={2} shown={20} total={47} totalPages={3} />);
    // The middle dot is the separator, so the two facts read as two facts.
    const status = screen.getByText("Page 2 of 3 \u00b7 20 of 47 results");
    expect(status.getAttribute("aria-live")).toBe("polite");
  });

  it("says only the count when everything fits on one page", () => {
    render(<PaginationStatus page={1} shown={47} total={47} totalPages={1} />);
    expect(screen.getByText("47 results")).toBeTruthy();
  });

  it("uses the singular for one result", () => {
    render(<PaginationStatus page={1} shown={1} total={1} totalPages={1} />);
    expect(screen.getByText("1 result")).toBeTruthy();
  });

  it("renders nothing for an empty list, which the empty state already covers", () => {
    const { container } = render(
      <PaginationStatus page={1} shown={0} total={0} totalPages={1} />
    );
    expect(container.innerHTML).toBe("");
  });

  it("merges onto a child link when enabled", () => {
    render(
      <Pagination>
        <PaginationLink asChild>
          <a href="/projects?page=2">Next</a>
        </PaginationLink>
      </Pagination>
    );
    // One element, not an anchor inside an anchor.
    expect(screen.getAllByRole("link", { name: "Next" })).toHaveLength(1);
  });
});
