import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, OTHER_AUTH, USER_AUTH } from "./constants";
import {
  createFixtureProject,
  fixtureName,
  openDb,
  userIdByEmail,
} from "./fixtures";

/**
 * The two ends of a project's life that the smoke suite's draft-to-published
 * walk never reaches: an owner taking a submission back and destroying it, and
 * staff retiring a published project and putting it back.
 *
 * Both start from a seeded status rather than by driving the stepper there.
 * The smoke suite already proves the path into `published`; repeating it here
 * would mean an archive assertion that fails at step one of six looks like an
 * archive bug.
 */
test.describe("project owner withdraw and delete", () => {
  test("owner takes a submission back to draft and deletes it", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const { db, close } = openDb();
    let projectId: string;
    try {
      const proposerId = await userIdByEmail(db, "user@example.com");
      ({ id: projectId } = await createFixtureProject(db, {
        title,
        proposerId,
        status: "submitted",
      }));
    } finally {
      await close();
    }

    const ownerContext = await browser.newContext({ storageState: USER_AUTH });
    const otherContext = await browser.newContext({ storageState: OTHER_AUTH });

    try {
      const owner = await ownerContext.newPage();
      await owner.goto(`/projects/${projectId}`);
      await waitForHydration(owner);

      await owner.getByRole("button", { name: "Withdraw to draft" }).click();

      // Draft is what the card offers next. Asserting the button that only
      // exists in the new status, rather than the absence of the old one:
      // an error would remove the old button too.
      await expect(
        owner.getByRole("button", { name: "Submit for review" })
      ).toBeVisible();

      // A second signed-in student, on the same URL. The issue asks for "no
      // owner actions card"; what the app actually does is stronger, because a
      // draft is not in the public catalog at all, so there is no page to put a
      // card on. Assert the real behavior rather than the weaker phrasing.
      const other = await otherContext.newPage();
      await other.goto(`/projects/${projectId}`);
      await expect(
        other.getByRole("heading", { name: "Not found" })
      ).toBeVisible();
      await expect(
        other.getByRole("heading", { name: "Your actions" })
      ).toHaveCount(0);

      await owner.getByRole("button", { name: "Delete draft" }).click();
      const confirm = owner.getByRole("alertdialog");
      await expect(
        confirm.getByText("Permanently delete this draft?")
      ).toBeVisible();
      // "Delete" is ConfirmDialog's default confirmLabel, which
      // OwnerProjectActions does not override.
      await confirm.getByRole("button", { name: "Delete" }).click();

      // The delete handler sets window.location.href rather than navigating
      // through the router, so this is a full page load, not a client
      // transition.
      await owner.waitForURL(/\/my\/projects/, { timeout: 15_000 });
      await expect(owner.getByText(title)).toHaveCount(0);
    } finally {
      await ownerContext.close();
      await otherContext.close();
    }
  });
});

test.describe("project archive and restore", () => {
  test("staff archive a published project and put it back", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const { db, close } = openDb();
    let projectId: string;
    try {
      const proposerId = await userIdByEmail(db, "user@example.com");
      ({ id: projectId } = await createFixtureProject(db, {
        title,
        proposerId,
        status: "published",
      }));
    } finally {
      await close();
    }

    const anonymous = await browser.newContext();
    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });

    try {
      const visitor = await anonymous.newPage();
      const listed = visitor.getByRole("heading", { name: title });

      // Searched by title rather than read off the first page of the catalog,
      // which carries the whole dev seed and would push a fixture anywhere.
      await visitor.goto(`/projects?q=${encodeURIComponent(title)}`);
      await expect(listed).toBeVisible();

      const staff = await staffContext.newPage();
      await staff.goto(`/projects/${projectId}`);
      await waitForHydration(staff);
      await archiveOrRestore(staff, "Archived");

      await visitor.goto(`/projects?q=${encodeURIComponent(title)}`);
      await expect(listed).toHaveCount(0);

      // The archived project has to still exist somewhere, or a search that
      // silently stopped matching would pass the assertion above. The catalog
      // keeps archived projects behind their own filter, so this is where it
      // went.
      await visitor.goto(
        `/projects?q=${encodeURIComponent(title)}&archivedOnly=true`
      );
      await expect(listed).toBeVisible();

      await archiveOrRestore(staff, "Published");

      await visitor.goto(`/projects?q=${encodeURIComponent(title)}`);
      await expect(listed).toBeVisible();
    } finally {
      await anonymous.close();
      await staffContext.close();
    }
  });
});

/**
 * Drives one stepper pill and waits for the status to land.
 *
 * Both directions are legal staff transitions (`published -> archived` and
 * `archived -> published` are the only entries in each other's row of
 * TRANSITIONS), so both go through the normal `Move to X` dialog rather than
 * the override path. The disabled pill is the page saying the write happened;
 * the closed dialog is not, because it closes on failure too.
 */
async function archiveOrRestore(
  page: Page,
  status: "Archived" | "Published"
): Promise<void> {
  await page.getByRole("button", { name: status, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText(`Move to ${status}`)).toBeVisible();
  await dialog.getByRole("button", { name: "Confirm" }).click();
  await expect(
    page.getByRole("button", { name: status, exact: true })
  ).toBeDisabled();
}
