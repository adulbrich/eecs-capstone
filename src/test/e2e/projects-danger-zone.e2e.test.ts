import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH } from "./constants";
import {
  createFixtureProject,
  fixtureName,
  userIdByEmail,
  withDb,
} from "./fixtures";
import { confirmed } from "./waits";

/**
 * The staff panel's danger zone: soft delete, restore, and the hard delete of
 * a draft. These are the three destructive controls on a project that no
 * other flow presses. "Archived" in projects-lifecycle.e2e.test.ts walks the
 * status stepper, which is a different write with a different reversal.
 */
test.describe("project danger zone", () => {
  test("staff soft delete a published project and restore it", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const { id: projectId } = await withDb(async (db) =>
      createFixtureProject(db, {
        title,
        proposerId: await userIdByEmail(db, "user@example.com"),
        status: "published",
      })
    );

    const anonymous = await browser.newContext();
    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const visitor = await anonymous.newPage();
      const listed = visitor.getByRole("heading", { name: title });
      await visitor.goto(`/projects?q=${encodeURIComponent(title)}`);
      await expect(listed).toBeVisible();

      const staff = await staffContext.newPage();
      await staff.goto(`/projects/${projectId}`);
      await waitForHydration(staff);

      await staff.getByRole("button", { name: "Soft delete" }).click();
      const dialog = staff.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await confirmed(staff, () =>
        dialog.getByRole("button", { name: "Soft delete" }).click()
      );
      // The panel swaps the control for its reversal, which is how it says
      // the row now carries a deletion timestamp.
      await expect(
        staff.getByRole("button", { name: "Restore" })
      ).toBeVisible();

      await visitor.goto(`/projects?q=${encodeURIComponent(title)}`);
      await expect(listed).toHaveCount(0);

      await confirmed(staff, () =>
        staff.getByRole("button", { name: "Restore" }).click()
      );
      await expect(
        staff.getByRole("button", { name: "Soft delete" })
      ).toBeVisible();

      await visitor.goto(`/projects?q=${encodeURIComponent(title)}`);
      await expect(listed).toBeVisible();
    } finally {
      await anonymous.close();
      await staffContext.close();
    }
  });

  test("staff hard delete a draft", async ({ browser }) => {
    const title = fixtureName("Project");
    const { id: projectId } = await withDb(async (db) =>
      createFixtureProject(db, {
        title,
        proposerId: await userIdByEmail(db, "user@example.com"),
        status: "draft",
      })
    );

    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/projects/${projectId}`);
      await waitForHydration(staff);

      await staff.getByRole("button", { name: "Hard delete" }).click();
      const dialog = staff.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Hard delete" }).click();
      await staff.waitForURL(/\/admin\/projects/, { timeout: 15_000 });

      // Gone, not hidden: the detail route has nothing to render.
      await staff.goto(`/projects/${projectId}`);
      await expect(
        staff.getByRole("heading", { name: "Not found" })
      ).toBeVisible();
    } finally {
      await staffContext.close();
    }
  });
});
