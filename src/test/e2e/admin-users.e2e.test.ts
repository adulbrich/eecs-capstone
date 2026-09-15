import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH } from "./constants";
import { createFixtureUser, readUser, withDb } from "./fixtures";
import { confirmed } from "./waits";

/**
 * The two writes on `/admin/users/:id` that change what a person can do. Both
 * act on a fixture account rather than a seeded one: the accessibility suite
 * signs in as the seeded users, and a ban left behind by a failed run would
 * lock it out.
 *
 * Asserted on the row as well as the page. The page re-reads through
 * `router.invalidate()`, so a control that flipped without writing would
 * still flip back on the next load; the row is what the ban actually is.
 */
test.describe("admin user role and ban", () => {
  test("staff change a role, ban with a reason, and unban", async ({
    browser,
  }) => {
    const { id: userId } = await withDb((db) => createFixtureUser(db));

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/admin/users/${userId}`);
      await waitForHydration(staff);

      const role = staff.getByRole("combobox", { name: "Role" });
      await expect(role).toHaveText("user");
      await role.click();
      await staff.getByRole("option", { name: "instructor" }).click();
      // Save and Ban each open a confirm carrying the email skip (#396); the
      // write goes out from the dialog's own button, so that is the click to
      // wait on. Unban mails nobody and confirms nothing.
      await staff.getByRole("button", { name: "Save", exact: true }).click();
      const roleDialog = staff.getByRole("dialog", {
        name: "Change the role?",
      });
      await expect(roleDialog).toBeVisible();
      await confirmed(staff, () =>
        roleDialog.getByRole("button", { name: "Save role" }).click()
      );
      await expect(roleDialog).toBeHidden();
      await expect(role).toHaveText("instructor");
      await expect(await withDb((db) => readUser(db, userId))).toMatchObject({
        role: "instructor",
      });

      await staff.getByLabel("Reason").fill("End-to-end ban");
      await staff.getByRole("button", { name: "Ban", exact: true }).click();
      const banDialog = staff.getByRole("alertdialog", {
        name: "Ban this user?",
      });
      await expect(banDialog).toBeVisible();
      await confirmed(staff, () =>
        banDialog.getByRole("button", { name: "Ban", exact: true }).click()
      );
      await expect(banDialog).toBeHidden();
      await expect(
        staff.getByRole("heading", { name: "Banned", exact: true })
      ).toBeVisible();
      await expect(staff.getByText("End-to-end ban")).toBeVisible();
      await expect(await withDb((db) => readUser(db, userId))).toMatchObject({
        banned: true,
        banReason: "End-to-end ban",
      });

      await confirmed(staff, () =>
        staff.getByRole("button", { name: "Unban" }).click()
      );
      await expect(
        staff.getByRole("heading", { name: "Ban this user" })
      ).toBeVisible();
      await expect(await withDb((db) => readUser(db, userId))).toMatchObject({
        banned: false,
      });
    } finally {
      await staffContext.close();
    }
  });
});
