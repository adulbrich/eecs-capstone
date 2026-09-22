import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { waitForHydration } from "../shared/playwright";
import {
  deleteFixtureUser,
  fixtureEmail,
  readUser,
  userIdByEmail,
  withDb,
} from "./fixtures";
import { emailCode, logSize } from "./mail";
import { confirmed } from "./waits";

/**
 * The whole account lifecycle, driven through the real forms: create an account
 * with an emailed code, sign out, sign back in with another, edit the profile,
 * sign out from it, sign in once more, and finally close the account.
 *
 * Every other test in this suite starts from a storage state minted once in
 * global setup, so none of them would notice if creating an account or coming
 * back to one broke. This is the only test that walks an account from its first
 * code to its deletion, and the only one whose fixture is a `user` row rather
 * than a project or an item. `email-code.e2e.test.ts` covers the code form's own
 * refusals; this covers what an account does across its life.
 *
 * ONID and GitHub are deliberately out of scope: both need a third-party
 * identity provider that no runner can drive.
 */
test.describe("account lifecycle", () => {
  test("create with a code, sign out and back in, edit, close", async ({
    page,
  }) => {
    const email = fixtureEmail();

    // The address has no row, so the code form asks for a name before it
    // redeems anything, and the row it creates is verified from the start: it
    // did not exist until the address was proved.
    await sendCode(page, "/sign-up", email);
    await expect(page.getByLabel("Your name", { exact: true })).toBeVisible();
    await page.getByLabel("Your name", { exact: true }).fill("End To End");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL("/");

    // Landing on a page is not proof of a session; a route behind the auth
    // guard is.
    await page.goto("/my/projects");
    await expect(page).toHaveURL(/\/my\/projects/);

    // Deletion below anonymizes the row rather than removing it (ADR-0008), so
    // the address on the row changes and the prefix sweep can no longer find
    // it: the id is read first and the row is deleted by hand afterwards.
    const userId = await withDb((db) => userIdByEmail(db, email));
    try {
      expect(await withDb((db) => readUser(db, userId))).toMatchObject({
        name: "End To End",
        emailVerified: true,
      });

      // Signed out through the menu rather than by clearing cookies, because
      // the sign-out itself is part of the lifecycle and because /sign-in
      // redirects a signed-in viewer away.
      await page.goto("/");
      await waitForHydration(page);
      await page.getByRole("button", { name: "End To End" }).click();
      await page.getByRole("menuitem", { name: "Sign out" }).click();
      await page.waitForURL(/\/sign-in/, { timeout: 15_000 });

      // Coming back is a second code, and an existing row goes straight in
      // with no name step: asking a returning person for their name again
      // would be the bug.
      await signInWithCode(page, email);
      await page.goto("/my/projects");
      await expect(page).toHaveURL(/\/my\/projects/);

      await page.goto("/profile");
      await waitForHydration(page);

      const profileForm = page.locator("form").filter({
        has: page.getByRole("button", { name: "Save profile" }),
      });
      await profileForm.getByLabel("Name").fill("End To End Edited");
      await profileForm.getByLabel("Affiliation").fill("E2E Lab");
      await confirmed(page, () =>
        profileForm.getByRole("button", { name: "Save profile" }).click()
      );
      await expect(profileForm.getByRole("status")).toHaveText("Saved.");
      expect(await withDb((db) => readUser(db, userId))).toMatchObject({
        name: "End To End Edited",
        affiliation: "E2E Lab",
      });

      // Embeddings are off in this suite's server, so the save lands on the
      // "saved, but no recommendations" branch; both branches begin with the
      // same word. Scoped to its form because the profile form above has just
      // printed "Saved." of its own.
      const interestsForm = page.locator("form").filter({
        has: page.getByLabel("Interests"),
      });
      await interestsForm.getByLabel("Interests").fill("Robots and sensors.");
      await confirmed(page, () =>
        interestsForm.getByRole("button", { name: "Save interests" }).click()
      );
      await expect(interestsForm.getByRole("status")).toHaveText(/^Saved/);
      const [interests] = await withDb((db) =>
        db
          .select({ text: schema.userInterests.interestsText })
          .from(schema.userInterests)
          .where(eq(schema.userInterests.userId, userId))
      );
      expect(interests.text).toBe("Robots and sensors.");

      // The profile page's own Sign out, which is a different control from
      // the header menu item pressed earlier in this flow.
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
      await signInWithCode(page, email);

      // Closing the account is the last thing the person can do, and the one
      // write here with a typed gate in front of it.
      await page.goto("/profile");
      await waitForHydration(page);
      await page.getByRole("button", { name: "Delete account" }).click();
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await dialog.getByLabel("Confirm email").fill(email);
      await dialog.getByRole("button", { name: "Delete my account" }).click();
      await page.waitForURL((url) => url.pathname === "/", {
        timeout: 15_000,
      });

      // The row no longer answers to the address, and it says why: it is no
      // longer that person's row. So a code for the address now reaches no
      // account at all, and the form treats it as somebody new. Stopping at
      // the name step leaves no second row to clean up.
      expect((await withDb((db) => readUser(db, userId))).email).toBe(
        `deleted-${userId}@invalid`
      );
      await sendCode(page, "/sign-in", email);
      await expect(page.getByLabel("Your name", { exact: true })).toBeVisible();
    } finally {
      await withDb((db) => deleteFixtureUser(db, userId));
    }
  });
});

/**
 * Opens the code form on `path`, asks for a code for `email` and confirms the
 * one that arrives, leaving the page wherever the form goes next: the name step
 * for an address with no row, or away from the form for one that has one.
 */
async function sendCode(page: Page, path: string, email: string) {
  await page.goto(path);
  await waitForHydration(page);
  await page.getByLabel("Email", { exact: true }).fill(email);
  const sentAt = await logSize();
  await page.getByRole("button", { name: "Email me a code" }).click();
  await page
    .getByLabel("Code", { exact: true })
    .fill(await emailCode(email, sentAt));
  await page.getByRole("button", { name: "Confirm code" }).click();
}

/** Signs an existing account in with a code, and waits to be let in. */
async function signInWithCode(page: Page, email: string) {
  await sendCode(page, "/sign-in", email);
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
    timeout: 15_000,
  });
  await expect(page.getByLabel("Your name", { exact: true })).toHaveCount(0);
}
