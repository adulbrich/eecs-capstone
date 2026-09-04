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
    // Two items under one searchable prefix, so the staff listing below can
    // show both at once and the overdue filter has something to leave out.
    const group = fixtureName("Overdue");
    const itemName = `${group}-late`;
    const onTimeName = `${group}-ontime`;
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
      const { id: onTimeId } = await createFixtureItem(db, onTimeName);
      await giveFixtureHold(db, {
        itemId: onTimeId,
        holderEmail: "user@example.com",
        dueAt: daysFromNow(10),
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

      // Staff see the same lateness the holder does (#150): the badge beside
      // the status, the due date without turning a column on, and a switch
      // that leaves only the late rows.
      const staff = await staffContext.newPage();
      await staff.goto(`/admin/inventory?q=${encodeURIComponent(group)}`);
      await waitForHydration(staff);

      const row = rowFor(staff, itemName);
      await expect(row.getByText("Checked out", { exact: true })).toBeVisible();
      await expect(row.getByText("Overdue", { exact: true })).toBeVisible();

      // The row carries more than one timestamp once every column is on, so
      // the due date is addressed by its own value rather than by "the time
      // element in this row". Visible with no Columns menu involved, which is
      // the half of this that #150 changed.
      await expect(
        row.locator(`time[datetime="${dueAt.toISOString()}"]`)
      ).toBeVisible();

      // The on-time item is the control: same holder, same status, a due date
      // in the future. Without it the filter below would prove nothing.
      const onTimeRow = rowFor(staff, onTimeName);
      await expect(onTimeRow).toBeVisible();
      await expect(onTimeRow.getByText("Overdue")).toHaveCount(0);

      await staff.getByRole("switch", { name: "Show only overdue" }).click();
      await expect(row).toBeVisible();
      await expect(onTimeRow).toHaveCount(0);
    } finally {
      await userContext.close();
      await staffContext.close();
    }
  });
});
