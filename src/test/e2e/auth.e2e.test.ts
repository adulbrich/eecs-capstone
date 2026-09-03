import { expect, test } from "@playwright/test";
import { SEED_PASSWORD, waitForHydration } from "../shared/playwright";

/**
 * Every other test in this suite starts from a saved storage state, which means
 * none of them would notice if /sign-in stopped working. This one drives the
 * real form, and it is the reason the suite can trust the others.
 */
test.describe("@smoke authentication", () => {
  test("signs in through the form", async ({ page }) => {
    await page.goto("/sign-in");
    await waitForHydration(page, "form");

    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password").fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

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
    // signing in has to honour it. A callbackURL in the sign-in body used to
    // come back as a redirect on the success path and win this race, landing
    // a verified person on /verify-email instead (#254).
    await page.goto("/sign-in?redirect=%2Fmy%2Fprojects");
    await waitForHydration(page, "form");

    await page.getByLabel("Email").fill("user@example.com");
    await page.getByLabel("Password").fill(SEED_PASSWORD);
    await page.getByRole("button", { name: /sign in/i }).click();

    await expect(page).toHaveURL(/\/my\/projects/, { timeout: 15_000 });

    // Reaching it is not the same as staying. The bug was a full-page
    // navigation arriving after the router's own, so a polling URL assertion
    // can sample the right address on the way to the wrong one. Waiting for
    // the navigation that must not happen is what makes this test fail on the
    // code it was written against.
    //
    // The regression this guards against assigns window.location.href inside
    // the client's onSuccess hook, which better-fetch awaits before signIn
    // resolves, so the competing navigation is already in flight before the
    // assertion above starts. What this window bounds is how long that page
    // load takes to commit on a loaded runner, not how long a response takes.
    // It is spent on every passing run and only buys detection on a failing
    // one, which is why it is seconds rather than the 15 above.
    //
    // Matched on the message: a bare rejection would also be satisfied by a
    // closed context or an aborted navigation, neither of which is proof that
    // nothing navigated.
    await expect(
      page.waitForURL(/\/verify-email/, { timeout: 5000 })
    ).rejects.toThrow(/Timeout/);
    await expect(page).toHaveURL(/\/my\/projects/);
  });
});
