import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { SEED_PASSWORD } from "./constants";

/**
 * Every other test in this suite starts from a saved storage state, which means
 * none of them would notice if /sign-in stopped working. This one drives the
 * real form, and it is the reason the suite can trust the others.
 */
test.describe("@smoke authentication", () => {
  test("signs in through the form", async ({ page }) => {
    await page.goto("/sign-in");
    await waitForHydration(page, "form");

    await page.fill('input[name="email"]', "user@example.com");
    await page.fill('input[name="password"]', SEED_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 15_000,
    });

    // Landing somewhere other than /sign-in is not proof of a session: an error
    // redirect would satisfy it too. Loading a route behind the auth guard is.
    await page.goto("/my/projects");
    await expect(page).toHaveURL(/\/my\/projects/);
  });
});
