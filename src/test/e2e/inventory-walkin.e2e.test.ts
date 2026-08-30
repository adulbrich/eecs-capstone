import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH } from "./constants";
import {
  createFixtureItem,
  daysFromNow,
  fixtureName,
  openDb,
  toDateInput,
} from "./fixtures";
import { statusSection } from "./locators";

/**
 * The counter path: staff hand an item to someone standing in front of them,
 * with no cart, no request line and no account on the other end.
 *
 * The smoke suite's inventory flow already walks `available -> checked_out ->
 * available`, but only ever through a request: the hold it checks out was
 * created by a student's cart, so the dialog arrives prefilled and the request
 * line carries the dates. This one has neither. It is the arm where
 * `inventory_items` holds the whole hold on its own columns, which is a
 * different write path and the one a walk-in actually uses.
 *
 * The visibility half is not a separate test, because it has to be asserted
 * against the same item in the same state: `/inventory/$itemId` is a public
 * route whose staff controls hang off a role check with no route guard, so the
 * only proof they are hidden is to load the page as the wrong viewer while they
 * would otherwise be on screen.
 */
test.describe("inventory walk-in checkout", () => {
  test("staff check an item out to a label and take it back", async ({
    browser,
  }) => {
    const itemName = fixtureName("Walkin");
    const holderLabel = fixtureName("Lab");
    const { db, close } = openDb();
    let itemId: string;
    try {
      ({ id: itemId } = await createFixtureItem(db, itemName));
    } finally {
      await close();
    }

    const anonymous = await browser.newContext();
    try {
      const visitor = await anonymous.newPage();
      await visitor.goto(`/inventory/${itemId}`);

      // The heading first, so the assertions below are about a page that
      // rendered rather than about an error boundary, which also contains no
      // "Check out" button and would pass every absence check.
      await expect(
        visitor.getByRole("heading", { level: 1, name: itemName })
      ).toBeVisible();

      // Status is public. This is the half of the page a student is entitled
      // to, and asserting it is what stops the absence checks below from
      // passing on a page that simply rendered nothing.
      await expect(visitor.getByText("Available")).toBeVisible();

      await expect(
        visitor.getByRole("button", { name: "Check out" })
      ).toHaveCount(0);
      await expect(visitor.getByRole("button", { name: "Return" })).toHaveCount(
        0
      );
      await expect(
        visitor.getByRole("heading", { name: "Staff panel", exact: true })
      ).toHaveCount(0);
    } finally {
      await anonymous.close();
    }

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/inventory/${itemId}`);
      await waitForHydration(staff);

      const status = statusSection(staff);

      await staff.getByRole("button", { name: "Check out" }).click();
      const dialog = staff.getByRole("dialog");
      await expect(dialog).toBeVisible();

      // Nothing is prefilled, unlike the request-backed checkout in the smoke
      // suite: this item was never requested, so there is no holder to inherit.
      await expect(dialog.getByLabel("Email")).toHaveValue("");

      // Leaving Email empty is what makes this a walk-in. HolderField shows the
      // Label input only while the address is blank, so filling one closes the
      // other, and the server refuses a hold carrying both.
      await dialog.getByLabel("Label", { exact: true }).fill(holderLabel);
      await dialog.getByLabel("Due date").fill(toDateInput(daysFromNow(14)));
      await dialog.getByRole("button", { name: "Confirm" }).click();

      // The status, not the closed dialog. A dialog closes on failure too.
      await expect(status.getByText("Checked out")).toBeVisible();
      await expect(status.getByText(holderLabel)).toBeVisible();

      await staff.getByRole("button", { name: "Return" }).click();

      // Back to available, which the panel says by offering check-out again.
      await expect(
        staff.getByRole("button", { name: "Check out" })
      ).toBeVisible();
      await expect(status.getByText(holderLabel)).toHaveCount(0);
    } finally {
      await staffContext.close();
    }
  });
});
