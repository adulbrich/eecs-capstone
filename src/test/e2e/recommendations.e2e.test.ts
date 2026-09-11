import { expect, test } from "@playwright/test";
import { SEED_RECOMMENDED_TITLES } from "../../../scripts/seed-recommendations";
import { waitForHydration } from "../shared/playwright";
import { OTHER_AUTH, USER_AUTH } from "./constants";

/**
 * The recommended sort, from the listing's side (#321).
 *
 * Bedrock is off in this suite, so nothing here embeds anything. The vectors
 * come from `npm run db:seed:dev`, which writes `scripts/seed-recommendations.ts`
 * into the columns: `user@example.com` has an interest vector, the seed's
 * published projects have vectors at known distances from it, and
 * `leej@oregonstate.edu` has no interests at all. The integration suite is
 * what proves the real embedding writers; this file proves what the reader
 * sees given a vector or not.
 */

const RECOMMENDED = "Recommended for you";

/** Opens the Sort select and returns the recommended option. */
async function recommendedOption(page: import("@playwright/test").Page) {
  await page.getByRole("combobox", { name: "Sort" }).click();
  return page.getByRole("option", { name: RECOMMENDED });
}

test.describe("@smoke recommendations gate", () => {
  test("a visitor is told to sign in and a member without interests to add them", async ({
    browser,
  }) => {
    // Signed out: no storage state at all.
    const anonymousContext = await browser.newContext();
    const memberContext = await browser.newContext({
      storageState: OTHER_AUTH,
    });
    try {
      const anonymous = await anonymousContext.newPage();
      await anonymous.goto("/projects");
      await waitForHydration(anonymous);
      const signIn = anonymous.getByRole("link", {
        name: "Sign in to get recommendations",
      });
      await expect(signIn).toBeVisible();
      await expect(signIn).toHaveAttribute("href", /\/sign-in\?.*redirect=/);
      await expect(
        anonymous.getByRole("link", { name: "Add your interests" })
      ).toHaveCount(0);
      // Radix marks a disabled item rather than dropping it from the list, so
      // the option is asserted on, not its absence.
      await expect(await recommendedOption(anonymous)).toHaveAttribute(
        "aria-disabled",
        "true"
      );
      await anonymous.keyboard.press("Escape");

      // A member with no interests row: the prompt points at the profile.
      const member = await memberContext.newPage();
      await member.goto("/projects");
      await waitForHydration(member);
      const addInterests = member.getByRole("link", {
        name: "Add your interests",
      });
      await expect(addInterests).toBeVisible();
      await expect(addInterests).toHaveAttribute("href", "/profile");
      await expect(
        member.getByRole("link", { name: "Sign in to get recommendations" })
      ).toHaveCount(0);
      await expect(await recommendedOption(member)).toHaveAttribute(
        "aria-disabled",
        "true"
      );
      await member.keyboard.press("Escape");
    } finally {
      await anonymousContext.close();
      await memberContext.close();
    }
  });
});

test.describe("recommended order", () => {
  test.use({ storageState: USER_AUTH });

  test("a member with interests picks the sort and sees the seeded order", async ({
    page,
  }) => {
    await page.goto("/projects");
    await waitForHydration(page);

    // Neither prompt: the loader already knew this viewer has a vector, so
    // nothing flashes on first paint either.
    await expect(
      page.getByRole("link", { name: "Add your interests" })
    ).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Sign in to get recommendations" })
    ).toHaveCount(0);

    const option = await recommendedOption(page);
    await expect(option).not.toHaveAttribute("aria-disabled", "true");
    await option.click();
    await page.waitForURL(/order=recommended/);
    await expect(page.getByText("Ranked by your interests.")).toBeVisible();

    // The seed's published projects, nearest the interest vector first. Rows
    // with no vector (anything another test published) sort after them, so
    // only the head of the list is pinned. Every level-3 heading on this page
    // is a card title; the page heading is the h1 and the filter bar uses
    // paragraphs.
    const titles = page.getByRole("heading", { level: 3 });
    await expect(titles.first()).toBeVisible();
    const head = (await titles.allTextContents()).slice(
      0,
      SEED_RECOMMENDED_TITLES.length
    );
    expect(head).toEqual([...SEED_RECOMMENDED_TITLES]);
  });
});
