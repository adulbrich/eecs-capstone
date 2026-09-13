// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { ListingLayout } from "#/components/listing-layout";

afterEach(cleanup);

function setup(activeFilterCount = 0) {
  return render(
    <ListingLayout
      activeFilterCount={activeFilterCount}
      filters={<label htmlFor="only-mine">Only mine</label>}
      search={<input aria-label="Search things" type="search" />}
      title={<h1>Things</h1>}
    >
      <p>results</p>
    </ListingLayout>
  );
}

/**
 * jsdom applies no stylesheet, so the `hidden xl:block` aside and the
 * `xl:hidden` button are both in the DOM here. What this pins is the
 * structure the CSS chooses between: the aside carries the filters, the
 * button carries the count, and the sheet opens on the same form.
 */
describe("ListingLayout", () => {
  it("renders the filters inside a labelled aside", () => {
    setup();
    const aside = screen.getByRole("complementary", { name: "Filters" });
    expect(within(aside).getByText("Only mine")).toBeInTheDocument();
  });

  it("puts the search beside the Filters button, above the results", () => {
    setup();
    expect(
      screen.getByRole("searchbox", { name: "Search things" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
    expect(screen.getByText("results")).toBeInTheDocument();
  });

  it("shows the active count on the button, and nothing at zero", () => {
    const { unmount } = setup(3);
    expect(
      screen.getByRole("button", { name: "Filters 3" })
    ).toBeInTheDocument();
    unmount();
    setup(0);
    expect(screen.getByRole("button", { name: "Filters" })).toBeInTheDocument();
  });

  it("opens a sheet titled Filters that holds the same form", async () => {
    const user = userEvent.setup();
    setup(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Filters 1" }));
    const dialog = await screen.findByRole("dialog", { name: "Filters" });
    expect(within(dialog).getByText("Only mine")).toBeInTheDocument();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
