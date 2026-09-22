import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { waitForHydration } from "../shared/playwright";
import { emailCode, logSize } from "./mail";

/**
 * Every other test in this suite starts from a saved storage state, which means
 * none of them would notice if /sign-in stopped working. This one drives the
 * real form against a seeded account, reading the code out of the mail the way
 * the person would, and it is the reason the suite can trust the others.
 */
test.describe("@smoke authentication", () => {
  test("signs in through the form", async ({ page }) => {
    await page.goto("/sign-in");
    await signInWithCode(page, "user@example.com");

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
    await signInWithCode(page, "user@example.com");

    await expect(page).toHaveURL(/\/my\/projects/, { timeout: 15_000 });
  });
});

/** Asks for a code on the page already open, and confirms the one mailed. */
async function signInWithCode(page: Page, email: string) {
  await waitForHydration(page);
  await page.getByRole("button", { name: "Email me a code instead" }).click();
  await page.getByLabel("Email", { exact: true }).fill(email);
  const sentAt = await logSize();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page
    .getByLabel("Code", { exact: true })
    .fill(await emailCode(email, sentAt));
  await page.getByRole("button", { name: "Confirm code" }).click();
}
