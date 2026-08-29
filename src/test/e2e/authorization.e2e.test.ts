import { expect, test } from "@playwright/test";
import { USER_AUTH } from "./constants";

/**
 * The admin layout redirects by role rather than rendering a 403, and the
 * public detail routes render staff panels on a role check with no route guard
 * at all. Both are browser behaviors, which is why they live here rather than
 * in the integration suite: a redirect is not something a server-function test
 * can observe.
 */
test.describe("@smoke authorization", () => {
  test("sends an anonymous visitor to sign-in with a return path", async ({
    page,
  }) => {
    await page.goto("/admin/projects");

    // The redirect param carries the clean path, not the search-param-normalized
    // one the router bounces through on the way. That is what a user returning
    // from sign-in depends on, so it is worth pinning exactly.
    await expect(page).toHaveURL("/sign-in?redirect=%2Fadmin%2Fprojects");
  });

  test("sends a signed-in non-staff user home", async ({ browser }) => {
    const context = await browser.newContext({
      storageState: USER_AUTH,
    });
    try {
      const page = await context.newPage();
      await page.goto("/admin/projects");
      await expect(page).toHaveURL("/");
    } finally {
      await context.close();
    }
  });
});
