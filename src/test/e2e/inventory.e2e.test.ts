import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, USER_AUTH } from "./constants";
import { createFixtureItem, fixtureName, openDb } from "./fixtures";

/**
 * The full cart path: available -> requested -> reserved -> checked_out ->
 * available, across three routes and two roles.
 *
 * The item is created here, on every attempt, rather than in global setup.
 * That is the difference between a retry that means something and one that
 * cannot pass: an attempt that dies at "Check out" leaves the item `reserved`,
 * and a retry starting there would fail at "Add to cart" for an unrelated
 * reason, hiding the original failure.
 */
test.describe("@smoke inventory lifecycle", () => {
  test("request, approve, check out, return", async ({ browser }) => {
    const itemName = fixtureName("Item");
    const { db, close } = openDb();
    let itemId: string;
    try {
      ({ id: itemId } = await createFixtureItem(db, itemName));
    } finally {
      await close();
    }

    const userContext = await browser.newContext({ storageState: USER_AUTH });
    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });

    try {
      const user = await userContext.newPage();

      await user.goto(`/inventory/${itemId}`);
      await waitForHydration(user);
      await user.getByRole("button", { name: "Add to cart" }).click();
      await expect(user.getByRole("button", { name: "In cart" })).toBeVisible();

      await user.goto("/my/items?tab=cart");
      await waitForHydration(user);
      await user.getByLabel("Note for staff").fill("Smoke test request.");
      await user.getByRole("button", { name: "Submit request" }).click();
      await expect(user).toHaveURL(/tab=active/);
      await expect(user.getByText(itemName)).toBeVisible();

      const staff = await staffContext.newPage();
      await staff.goto("/admin/inventory/requests");
      await waitForHydration(staff);

      // Scope to this item's row: the page lists every pending request, and the
      // seed drives several of its own through the same states.
      const row = staff.locator("tr", { hasText: itemName });
      await row.getByRole("button", { name: "Approve" }).click();
      await staff.getByRole("button", { name: "Confirm approve" }).click();
      // The page lists pending requests, so an approved line leaving the table
      // is the page saying the transition landed. A closed popover is not:
      // it closes on failure too.
      await expect(row).toHaveCount(0);

      await staff.goto(`/inventory/${itemId}`);
      await waitForHydration(staff);
      await staff.getByRole("button", { name: "Check out" }).click();

      const dialog = staff.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // The holder is already the requester: approving the request recorded
      // them, and the dialog prefills from that. Asserting it here is how the
      // test proves the hold carried across the two roles, and it is also why
      // there is no Label field to fill: HolderField hides it whenever an
      // email is present.
      await expect(dialog.getByLabel("Email")).toHaveValue("user@example.com");
      await dialog.getByLabel("Due date").fill(dueDateInput());
      await dialog.getByRole("button", { name: "Confirm" }).click();
      await expect(dialog).toBeHidden();

      await expect(staff.getByRole("button", { name: "Return" })).toBeVisible();
      await staff.getByRole("button", { name: "Return" }).click();

      // Back to available, which the panel says by offering check-out again.
      await expect(
        staff.getByRole("button", { name: "Check out" })
      ).toBeVisible();

      await user.goto("/my/items?tab=history");
      await waitForHydration(user);
      await expect(user.getByText(itemName)).toBeVisible();
    } finally {
      await userContext.close();
      await staffContext.close();
    }
  });
});

/** Two weeks out, in the YYYY-MM-DD shape a date input expects. */
function dueDateInput(): string {
  const due = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
  return due.toISOString().slice(0, 10);
}
