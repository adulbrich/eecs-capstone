import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { enterEmailedCode } from "./mail";

/**
 * Every other test in this suite starts from a saved storage state, which means
 * none of them would notice if /sign-in stopped working. This one drives the
 * real form against a seeded account, reading the code out of the mail the way
 * the person would, and it is the reason the suite can trust the others.
 */
test.describe("@smoke authentication", () => {
  test("signs in through the form", async ({ page }) => {
    await page.goto("/sign-in");
    await waitForHydration(page);
    await enterEmailedCode(page, "user@example.com");

    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 15_000,
    });

    // Landing somewhere other than /sign-in is not proof of a session: an error
    // redirect would satisfy it too. Loading a route behind the auth guard is.
    await page.goto("/my/projects");
    await expect(page).toHaveURL(/\/my\/projects/);
  });

  test("returns to the page that sent it here", async ({ page }) => {
    // The guard sends an anonymous visitor to /sign-in?redirect=<path>, and
    // signing in has to honour it. The code form navigates on success itself,
    // so this is the only thing standing between a person and the page they
    // were trying to reach.
    await page.goto("/sign-in?redirect=%2Fmy%2Fprojects");
    await waitForHydration(page);
    await enterEmailedCode(page, "user@example.com");

    await expect(page).toHaveURL(/\/my\/projects/, { timeout: 15_000 });
  });
});
