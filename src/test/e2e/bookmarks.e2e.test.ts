import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { OTHER_AUTH, OTHER_EMAIL, USER_AUTH } from "./constants";
import {
  createFixtureProject,
  fixtureName,
  openDb,
  userIdByEmail,
} from "./fixtures";
import { confirmed } from "./waits";

/**
 * Bookmarks are the one project feature with no staff involvement and no
 * status: a student marks a published project, and it appears on a list only
 * they can see.
 *
 * That last part is why the second viewer is here rather than in a separate
 * test. `/my/bookmarks` is one URL that renders different rows per viewer, so
 * "private to the bookmarking user" is only proven by loading the same URL as
 * someone else while the row exists.
 */
test.describe("project bookmarks", () => {
  test("a student bookmarks a project, finds it, and removes it", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const { db, close } = openDb();
    let projectId: string;
    try {
      // Proposed by the *other* user, so the bookmarking student has no
      // ownership claim on it. A student bookmarking their own proposal would
      // pass even if the list were keyed on the proposer by mistake.
      const proposerId = await userIdByEmail(db, OTHER_EMAIL);
      ({ id: projectId } = await createFixtureProject(db, {
        title,
        proposerId,
        status: "published",
      }));
    } finally {
      await close();
    }

    const userContext = await browser.newContext({ storageState: USER_AUTH });
    const otherContext = await browser.newContext({ storageState: OTHER_AUTH });

    try {
      const user = await userContext.newPage();
      await user.goto(`/projects/${projectId}`);
      await waitForHydration(user);

      // The accessible name is the aria-label, which flips with the state; the
      // visible text says "Bookmarked" while the label says "Remove bookmark".
      // Naming the label is what makes this assertion about the control the
      // screen reader announces rather than the glyph beside it.
      // Waited for, not just clicked. `BookmarkButton` flips its own label
      // before the request resolves, so the assertion below is true whether or
      // not the row was ever written, and the navigation that follows would
      // abort the write.
      await confirmed(user, () =>
        user.getByRole("button", { name: "Bookmark", exact: true }).click()
      );
      await expect(
        user.getByRole("button", { name: "Remove bookmark" })
      ).toBeVisible();

      await user.goto("/my/bookmarks");
      await expect(user.getByText(title)).toBeVisible();

      const other = await otherContext.newPage();
      await other.goto("/my/bookmarks");

      // The heading proves the page rendered for the second student, so the
      // absence below is "not on their list" rather than "page never loaded".
      await expect(
        other.getByRole("heading", { name: "My Bookmarks" })
      ).toBeVisible();
      await expect(other.getByText(title)).toHaveCount(0);

      await user.goto(`/projects/${projectId}`);
      await waitForHydration(user);
      await confirmed(user, () =>
        user.getByRole("button", { name: "Remove bookmark" }).click()
      );
      await expect(
        user.getByRole("button", { name: "Bookmark", exact: true })
      ).toBeVisible();

      await user.goto("/my/bookmarks");
      await expect(user.getByText(title)).toHaveCount(0);
    } finally {
      await userContext.close();
      await otherContext.close();
    }
  });
});
