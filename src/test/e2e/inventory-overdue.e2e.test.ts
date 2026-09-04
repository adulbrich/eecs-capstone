import { expect, test } from "@playwright/test";
import { closeMenu, waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, USER_AUTH } from "./constants";
import {
  createFixtureItem,
  daysFromNow,
  fixtureName,
  giveFixtureHold,
  openDb,
} from "./fixtures";
import { entryFor, rowFor } from "./locators";

/**
 * Overdue is derived, never stored. There is no cron and no `overdue` column:
 * `src/lib/inventory-deadlines.ts` compares the due date to now every time a
 * page is read, and the matching notification is inserted lazily by the
 * `/my/items` read path itself.
 *
 * That makes it a browser test rather than a server one in a specific way: the
 * only thing that makes the notification exist is somebody loading the page.
 */
test.describe("inventory overdue derivation", () => {
  test("a past due date shows the holder a badge and files a notice", async ({
    browser,
  }) => {
    const itemName = fixtureName("Item");
    const dueAt = daysFromNow(-10);
    const { db, close } = openDb();
    let itemId: string;
    try {
      ({ id: itemId } = await createFixtureItem(db, itemName));
      await giveFixtureHold(db, {
        itemId,
        holderEmail: "user@example.com",
        dueAt,
      });
    } finally {
      await close();
    }

    const userContext = await browser.newContext({ storageState: USER_AUTH });
    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });

    try {
      const user = await userContext.newPage();
      await user.goto("/my/items?tab=active");
      await waitForHydration(user);

      const entry = entryFor(user, itemName);

      // A staff-assigned hold, which is the arm of DeadlineEntry whose dates
      // live on the item rather than on a request line. "Assigned to you by
      // staff" is how the Who column says which arm it took.
      await expect(entry.getByText("Assigned to you by staff")).toBeVisible();
      await expect(entry.getByText("Overdue", { exact: true })).toBeVisible();

      // The date itself, off the `datetime` attribute rather than the rendered
      // text: LocalTime switches to the reader's locale in an effect, so the
      // visible string depends on the machine running the test and the ISO
      // attribute does not.
      await expect(entry.locator("time")).toHaveAttribute(
        "datetime",
        dueAt.toISOString()
      );

      // The reload is not incidental. Loading /my/items is what inserts the
      // notification, server-side, during the loader; the bell fetched its
      // count when the layout mounted, which was before that insert. Only a
      // fresh mount sees it.
      await user.reload();
      await waitForHydration(user);
      await user.getByRole("button", { name: "Notifications" }).click();
      await expect(user.getByText(`Overdue: ${itemName}`)).toBeVisible();
      await closeMenu(user);

      // Staff see the same hold, but the app gives them no overdue treatment:
      // no badge, no filter, and the Due column is hidden until somebody turns
      // it on. Asserting what is actually there rather than what would be
      // useful, because a test written against the second one would fail on
      // every run and prove nothing about a regression.
      const staff = await staffContext.newPage();
      await staff.goto(`/admin/inventory?q=${encodeURIComponent(itemName)}`);
      await waitForHydration(staff);

      const row = rowFor(staff, itemName);
      await expect(row.getByText("Checked out", { exact: true })).toBeVisible();

      // The row carries more than one timestamp once every column is on, so
      // the due date is addressed by its own value rather than by "the time
      // element in this row".
      const dueCell = row.locator(`time[datetime="${dueAt.toISOString()}"]`);

      // Absent first. That is the assertion that the toggle below is what puts
      // it on screen, rather than it having been visible all along.
      await expect(dueCell).toHaveCount(0);

      await staff.getByRole("button", { name: "Columns" }).click();
      await staff.getByRole("menuitemcheckbox", { name: "Due" }).click();
      await closeMenu(staff);

      await expect(dueCell).toBeVisible();
    } finally {
      await userContext.close();
      await staffContext.close();
    }
  });
});
