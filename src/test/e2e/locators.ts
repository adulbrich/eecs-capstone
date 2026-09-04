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
export function rowFor(page: Page, text: string): Locator {
  return page.getByRole("row").filter({ hasText: text });
}

/**
 * One entry on `/my/items`, by the item it is about.
 *
 * The tabs are `AdminDataTable`s, so an entry is a table row and `rowFor`
 * scoped to the open tab panel is what reaches it. The scope matters: the
 * page renders one table per tab, and only the selected panel is in the tree,
 * but scoping to it keeps the locator from ever matching a row in another
 * tab's table if that changes.
 *
 * This used to be a `> div > div` chain from when the entries were plain
 * divs. That chain kept matching after the tables landed, on the table's
 * wrapper rather than a row, which is why a test that only looked for one
 * button inside it stayed green while one that asserted on a `time` element
 * hit every row at once.
 */
export function entryFor(page: Page, itemName: string): Locator {
  return page
    .getByRole("tabpanel")
    .getByRole("row")
    .filter({ hasText: itemName });
}

/**
 * The staff panel's own Status section on an item page.
 *
 * Scoped, because the public header renders a status badge too: an unscoped
 * `getByText("Retired")` matches twice and cannot say which of the two moved.
 * `exact` keeps this off the neighbouring "Status history" section.
 */
export function statusSection(page: Page): Locator {
  return page.locator("section").filter({
    has: page.getByRole("heading", { name: "Status", exact: true }),
  });
}
