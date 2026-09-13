import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH } from "./constants";
import {
  createFixtureProject,
  fixtureName,
  userIdByEmail,
  withDb,
} from "./fixtures";

/**
 * The four listings on `ListingLayout`, each driven from the filters sheet a
 * phone gets below `xl`: apply one filter from inside the sheet, watch the
 * rows narrow, restore them.
 *
 * The accessibility suite opens the same sheet on every listing and asserts
 * focus, overflow and axe; the one filter it changes is asserted on the URL
 * alone. This is the suite that reads the count under the list, so a filter
 * whose param lands in the URL and reaches no query would fail here and
 * nowhere else.
 *
 * Every filter picked is one the seed makes predictable, and every count
 * assertion is relative (fewer than before, back to before) because the
 * local database drifts between runs (QUIRKS, "The smoke and accessibility
 * suites share one local database"). The one row a test creates is the
 * published project with "Accepting applicants" off; `createFixtureProject`
 * says why the seed cannot supply it.
 */
test.describe("@smoke listing filters sheet", () => {
  test("projects: Accepting applicants narrows the list, Clear all restores it", async ({
    page,
  }) => {
    await withDb(async (db) =>
      createFixtureProject(db, {
        acceptingApplicants: false,
        proposerId: await userIdByEmail(db, "user@example.com"),
        status: "published",
        title: fixtureName("Project"),
      })
    );

    const before = await openListing(page, "/projects");
    const sheet = await openSheet(page);
    await sheet.getByRole("switch", { name: "Accepting applicants" }).click();
    await expect(page).toHaveURL(/acceptingOnly=true/);
    await expectNarrowed(page, sheet, before);

    await clearAll(page, sheet);
    // Absence of the value, not of the key: `/projects` keeps its default
    // params in the URL, so `acceptingOnly=false` is what a cleared filter
    // reads there.
    await expect(page).not.toHaveURL(/acceptingOnly=true/);
    await expectRestored(page, sheet, before);
  });

  test("inventory: a status narrows the list, Clear all restores it", async ({
    page,
  }) => {
    const before = await openListing(page, "/inventory");
    const sheet = await openSheet(page);
    await pickStatus(page, sheet, "Maintenance");
    await expect(page).toHaveURL(/status=maintenance/);
    await expectNarrowed(page, sheet, before);

    await clearAll(page, sheet);
    await expect(page).not.toHaveURL(/status=maintenance/);
    await expectRestored(page, sheet, before);
  });

  test("admin inventory: a status narrows the table, Clear all restores it", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await context.newPage();
      const before = await openListing(staff, "/admin/inventory");
      const sheet = await openSheet(staff);
      await pickStatus(staff, sheet, "Maintenance");
      await expect(staff).toHaveURL(/status=maintenance/);
      await expectNarrowed(staff, sheet, before);

      await clearAll(staff, sheet);
      await expect(staff).not.toHaveURL(/status=maintenance/);
      await expectRestored(staff, sheet, before);
    } finally {
      await context.close();
    }
  });

  test("admin projects: unchecking a status narrows the table, rechecking it restores the table", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await context.newPage();
      const before = await openListing(staff, "/admin/projects");
      const sheet = await openSheet(staff);
      // Published, because the seed has more of those than of any other
      // status in the default set, so the drop is the largest one available.
      const published = sheet.getByRole("checkbox", { name: "Published" });
      await published.click();
      await expect(published).not.toBeChecked();
      // The default set travels as an absent param and any other set in
      // full, so a narrowed status set is the key appearing at all. `[?&]`
      // keeps `sort=status` from satisfying this.
      await expect(staff).toHaveURL(/[?&]status=/);
      await expectNarrowed(staff, sheet, before);

      // Rechecked rather than cleared: this listing has no Clear all (#355),
      // so the inverse click is what restores the default set, and the URL
      // dropping the key is what proves the set is the default again.
      await reopenSheet(staff, sheet);
      await published.click();
      await expect(staff).not.toHaveURL(/[?&]status=/);
      await expectRestored(staff, sheet, before);
    } finally {
      await context.close();
    }
  });
});

/**
 * Loads a listing at phone width and returns how many rows it reports.
 *
 * 375x812 is where the Filters button exists at all: the layout hides it
 * from `xl`, where the same form is an aside instead.
 */
async function openListing(page: Page, path: string): Promise<number> {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(path);
  await waitForHydration(page);
  return await readTotal(page);
}

/** Opens the sheet from its button and waits for it. */
async function openSheet(page: Page): Promise<Locator> {
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Filters" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * Picks an option in the sheet's Status select. The trigger is inside the
 * sheet; the listbox is a Radix portal under `body`, so the option is found
 * on the page rather than in the sheet.
 */
async function pickStatus(
  page: Page,
  sheet: Locator,
  label: string
): Promise<void> {
  await sheet.getByRole("combobox", { name: "Status" }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/**
 * The narrowed half of every case: the sheet stayed open (a filter change is
 * a navigation on the same route, not a close), the count dropped, and once
 * closed the button carries the one active filter.
 */
async function expectNarrowed(
  page: Page,
  sheet: Locator,
  before: number
): Promise<void> {
  await expect(sheet).toBeVisible();
  await expect
    .poll(() => readTotal(page), { timeout: 10_000 })
    .toBeLessThan(before);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Filters 1", exact: true })
  ).toBeVisible();
}

/** Reopens the sheet by its counted name, while it counts one filter. */
async function reopenSheet(page: Page, sheet: Locator): Promise<void> {
  await page.getByRole("button", { name: "Filters 1", exact: true }).click();
  await expect(sheet).toBeVisible();
}

/** Reopens the sheet and clicks Clear all inside it. */
async function clearAll(page: Page, sheet: Locator): Promise<void> {
  await reopenSheet(page, sheet);
  await sheet.getByRole("button", { name: "Clear all" }).click();
}

/**
 * The restored half: the count is back to what the page first reported and
 * the button has lost its badge. Equal rather than "more than the narrowed
 * count", because nothing else ran in between to move it.
 */
async function expectRestored(
  page: Page,
  sheet: Locator,
  before: number
): Promise<void> {
  await expect(sheet).toBeVisible();
  await expect.poll(() => readTotal(page), { timeout: 10_000 }).toBe(before);
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
  await expect(
    page.getByRole("button", { name: "Filters", exact: true })
  ).toBeVisible();
}

/**
 * The total the count under the list reports, as a number.
 *
 * `PaginationStatus` renders that count on every listing, paged
 * (`Page 1 of 2 · 10 of 15 results`) or not (`15 results`), and `ListCount`
 * wraps the same element, so the trailing number is the total on all four.
 * A `data-slot` rather than a role, because a polite live region has no
 * role to select by (QUIRKS, "Browser suites select by role and name").
 * `textContent` waits for the element, which matters while a navigation is
 * in flight; a total of zero renders nothing, and a filter that empties the
 * list therefore fails here with a locator timeout rather than passing a
 * "fewer" assertion on a page that shows no rows.
 */
async function readTotal(page: Page): Promise<number> {
  const text = await page
    .locator('[data-slot="pagination-status"]')
    .textContent();
  const match = /(\d+) results?$/.exec(text ?? "");
  if (!match) {
    throw new Error(`No result count under the list, got: ${text}`);
  }
  return Number(match[1]);
}
