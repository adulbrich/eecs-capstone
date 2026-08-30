import type { Locator, Page } from "@playwright/test";

/**
 * The locators more than one flow needs, by accessible role wherever the markup
 * offers one.
 *
 * `entryFor` lived in two test files as a copied `.locator("> div > div")`
 * chain, which is the shape most likely to break on a markup change and the
 * worst one to have two copies of: the two would drift and the second would
 * keep passing for the wrong reason.
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
 * The tab panel holds a single wrapper div whose children are the entries, so
 * `> div > div` is the entry row. There is no role here to use instead: the
 * entries are plain divs, and adding a test id to reach them is what the
 * convention in `docs/QUIRKS.md` rules out.
 *
 * Filtering plain `div` by text instead lands on the innermost box holding the
 * name, which is the text column beside the Cancel button rather than the row
 * containing both. That locator finds the item and then reports no button,
 * which is also what a broken gate looks like.
 */
export function entryFor(page: Page, itemName: string): Locator {
  return page
    .getByRole("tabpanel")
    .locator("> div > div")
    .filter({ hasText: itemName });
}
