import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, OTHER_AUTH, OTHER_EMAIL, USER_AUTH } from "./constants";
import {
  createFixtureItem,
  createFixtureRequestLine,
  fixtureName,
  openDb,
  userIdByEmail,
} from "./fixtures";

/**
 * The two ways a request ends without the item ever changing hands: staff
 * reject it, or the requester takes it back.
 *
 * Both paths write a closing reason and both surface it on `/my/items`, which
 * is the only page in the app where a student is told why. The smoke suite
 * approves and never exercises either.
 */
test.describe("inventory request rejection", () => {
  test("staff reject with a reason the requester can read", async ({
    browser,
  }) => {
    const itemName = fixtureName("Item");
    const reason = `Out on loan until next term. ${fixtureName("Reason")}`;
    const { db, close } = openDb();
    let itemId: string;
    try {
      ({ id: itemId } = await createFixtureItem(db, itemName));
      const userId = await userIdByEmail(db, "user@example.com");
      await createFixtureRequestLine(db, { itemId, userId });
    } finally {
      await close();
    }

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    const userContext = await browser.newContext({ storageState: USER_AUTH });
    const otherContext = await browser.newContext({ storageState: OTHER_AUTH });

    try {
      const staff = await staffContext.newPage();
      await staff.goto("/admin/inventory/requests");
      await waitForHydration(staff);

      // Scoped to this item's row: the queue lists every pending request and
      // the dev seed drives several of its own.
      const row = staff.locator("tr", { hasText: itemName });
      await row.getByRole("button", { name: "Reject" }).click();
      await staff.getByLabel("Reason (sent to requester)").fill(reason);
      await staff.getByRole("button", { name: "Confirm reject" }).click();

      // The queue is filtered to pending, so the row leaving it is the page
      // saying the write landed. The popover closing is not: it closes on
      // failure too.
      await expect(row).toHaveCount(0);

      const user = await userContext.newPage();
      await user.goto("/my/items?tab=history");
      await waitForHydration(user);
      await expect(user.getByText(itemName)).toBeVisible();
      await expect(user.getByText(reason)).toBeVisible();

      // The second student's own history, which is the same URL rendering
      // different rows. The reason names a specific person's request, so this
      // is the assertion that it reaches only them.
      const other = await otherContext.newPage();
      await other.goto("/my/items?tab=history");
      await waitForHydration(other);
      await expect(other.getByText(reason)).toHaveCount(0);

      // And not through the item either, which is a public page carrying the
      // same item's history for anyone who opens it.
      await other.goto(`/inventory/${itemId}`);
      await expect(
        other.getByRole("heading", { level: 1, name: itemName })
      ).toBeVisible();
      await expect(other.getByText(reason)).toHaveCount(0);
    } finally {
      await staffContext.close();
      await userContext.close();
      await otherContext.close();
    }
  });
});

test.describe("inventory request self-cancel", () => {
  test("the requester cancels while pending", async ({ browser }) => {
    const itemName = fixtureName("Item");
    const { db, close } = openDb();
    try {
      const { id: itemId } = await createFixtureItem(db, itemName);
      const userId = await userIdByEmail(db, "user@example.com");
      await createFixtureRequestLine(db, { itemId, userId });
    } finally {
      await close();
    }

    const userContext = await browser.newContext({ storageState: USER_AUTH });
    const otherContext = await browser.newContext({ storageState: OTHER_AUTH });
    try {
      const user = await userContext.newPage();
      await user.goto("/my/items?tab=active");
      await waitForHydration(user);

      await entryFor(user, itemName)
        .getByRole("button", { name: "Cancel" })
        .click();

      // Off the active tab entirely, which is what a cancelled line does: the
      // Active tab lists pending and approved lines only.
      await expect(user.getByText(itemName)).toHaveCount(0);
      await user.goto("/my/items?tab=history");
      await waitForHydration(user);
      await expect(user.getByText(itemName)).toBeVisible();

      // The second student never had a control to press, because the entry is
      // not on their list at all. The server's own refusal of a cross-user
      // cancel is asserted in the integration suite, which can call
      // `cancelRequestItem` as the wrong viewer; a browser cannot reach a
      // button that was never rendered.
      const other = await otherContext.newPage();
      await other.goto("/my/items?tab=active");
      await waitForHydration(other);
      await expect(other.getByText(itemName)).toHaveCount(0);
    } finally {
      await userContext.close();
      await otherContext.close();
    }
  });

  test("the cancel control is gone once the item is checked out", async ({
    browser,
  }) => {
    const itemName = fixtureName("Item");
    const { db, close } = openDb();
    try {
      const { id: itemId } = await createFixtureItem(db, itemName);
      const userId = await userIdByEmail(db, "user@example.com");
      // Approved and collected. The server refuses `self_cancel` past checkout,
      // and the page has to agree with it: the button is gated on the *item's*
      // status, not the line's, because an approved line sits on an item that
      // may or may not have been picked up yet.
      await createFixtureRequestLine(db, {
        itemId,
        userId,
        lineStatus: "approved",
        itemStatus: "checked_out",
      });
    } finally {
      await close();
    }

    const userContext = await browser.newContext({ storageState: USER_AUTH });
    try {
      const user = await userContext.newPage();
      await user.goto("/my/items?tab=active");
      await waitForHydration(user);

      const entry = entryFor(user, itemName);

      // The entry is on screen, so the missing button below is a gate rather
      // than an empty list.
      await expect(entry).toBeVisible();
      await expect(entry.getByRole("button", { name: "Cancel" })).toHaveCount(
        0
      );
    } finally {
      await userContext.close();
    }
  });
});

/**
 * Every "the other student cannot see this" assertion in the suite is worth
 * nothing if both storage states turn out to hold the same session, and a
 * silently reused one would make all of them pass. This is the check that the
 * second one is a different account.
 */
test("the second storage state is the second seeded student", async ({
  browser,
}) => {
  const context = await browser.newContext({ storageState: OTHER_AUTH });
  try {
    const page = await context.newPage();
    await page.goto("/profile");
    await expect(page.getByText(OTHER_EMAIL)).toBeVisible();
  } finally {
    await context.close();
  }
});

/**
 * One entry on `/my/items`, by the item it is about.
 *
 * The tab panel holds a single wrapper div whose children are the entries, so
 * `> div > div` is the entry row. Filtering plain `div` by text instead lands
 * on the innermost box holding the name, which is the text column beside the
 * Cancel button rather than the row containing both. That locator finds the
 * item and then reports no button, which is exactly what a broken gate would
 * also look like.
 */
function entryFor(page: Page, itemName: string) {
  return page
    .getByRole("tabpanel")
    .locator("> div > div")
    .filter({ hasText: itemName });
}
