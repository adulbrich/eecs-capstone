import type { Locator, Page } from "@playwright/test";

/**
 * The locators more than one flow needs, by accessible role wherever the markup
 * offers one.
 *
 * `entryFor` lived in two test files as a copied structural chain, which is
 * the shape most likely to break on a markup change and the worst one to have
 * two copies of: the two would drift and the second would keep passing for the
 * wrong reason.
 */

/**
 * One row of an admin table, by text it contains.
 *
 * `getByRole("row")` rather than `locator("tr")`, per the convention recorded
 * in `docs/QUIRKS.md` under "Browser suites select by role and name". Filtered
 * rather than named, because a row's accessible name is every cell concatenated
 * and matching against that is matching against the whole row's layout.
 */
export function rowFor(scope: Page | Locator, text: string): Locator {
  return scope.getByRole("row").filter({ hasText: text });
}

/**
 * One entry on `/my/items`, by the item it is about.
 *
 * The page is one `AdminDataTable` grouped by request, so an entry is a
 * table row and `rowFor` scoped to that table reaches it. Group headers are
 * rows too, but they name a request rather than an item, so the text filter
 * never lands on one. Scoped to the table by its accessible name rather than
 * to the page, so a second table on the page would not widen this.
 *
 * This used to be a `> div > div` chain from when the entries were plain
 * divs, then a lookup inside the open tab panel. The chain kept matching
 * after the tables landed, on the table's wrapper rather than a row, which
 * is why a test that only looked for one button inside it stayed green while
 * one that asserted on a `time` element hit every row at once. The general
 * form of that trap is in `docs/QUIRKS.md` under "A structural selector
 * fails open when the markup under it changes".
 */
export function entryFor(page: Page, itemName: string): Locator {
  return rowFor(page.getByRole("table", { name: "My items" }), itemName);
}

/**
 * The group an entry sits in: the `tbody` whose header carries `text`. A
 * hold assigned by staff sits under "Assigned to you by staff", a submitted
 * request under its date.
 */
export function groupFor(page: Page, text: string): Locator {
  return page.getByRole("rowgroup").filter({ hasText: text });
}

/**
 * The staff panel's own Status section on an item page.
 *
 * Scoped, because the public header renders a status badge too: an unscoped
 * `getByText("Retired")` matches twice and cannot say which of the two moved.
 * `exact` keeps this off the neighbouring "Status history" section.
 */
export function statusSection(page: Page): Locator {
  return sectionNamed(page, "Status");
}

/**
 * A `section` by the exact heading it carries. The admin program page has
 * one per concern (the form, the instructors), and a "Remove" inside one of
 * them is not the "Remove" inside another.
 */
export function sectionNamed(page: Page, heading: string): Locator {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: heading, exact: true }),
  });
}
