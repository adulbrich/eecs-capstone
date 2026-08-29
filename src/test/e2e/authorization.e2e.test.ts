import { expect, test } from "@playwright/test";
import { and, ilike, like, not } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { USER_AUTH } from "./constants";
import { E2E_PREFIX, openDb } from "./fixtures";

/**
 * The admin layout redirects by role rather than rendering a 403, and the
 * public detail routes render their staff panels on a role check with no route
 * guard at all. Both are browser behaviors, which is why they live here rather
 * than in the integration suite: a redirect is not something a server-function
 * test can observe, and a conditionally rendered panel is only absent in a real
 * render.
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
    const context = await browser.newContext({ storageState: USER_AUTH });
    try {
      const page = await context.newPage();
      await page.goto("/admin/projects");
      await expect(page).toHaveURL("/");
    } finally {
      await context.close();
    }
  });

  test("hides the staff panels on the public item page from a plain user", async ({
    browser,
  }) => {
    const item = await seededItem();

    const context = await browser.newContext({ storageState: USER_AUTH });
    try {
      const page = await context.newPage();
      await page.goto(`/inventory/${item.id}`);

      // Prove the page rendered before asserting on what is missing: an error
      // boundary also has no staff panel and would pass the checks below.
      //
      // The heading, not a cart button. Whether "Add to cart" renders depends
      // on the item's status, and the seed leaves its alphabetically first item
      // `requested`, which shows "This item is not available right now" and no
      // button at all. A sentinel for "did this page render" must not itself be
      // conditional.
      await expect(
        page.getByRole("heading", { level: 1, name: item.name })
      ).toBeVisible();

      // InventoryPrivatePanel and StaffInventoryPanel both hang off
      // detail.viewerIsStaff, with nothing in the route to enforce it.
      await expect(
        page.getByRole("heading", { name: "Private", exact: true })
      ).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Check out" })).toHaveCount(
        0
      );
    } finally {
      await context.close();
    }
  });
});

/**
 * A seeded item, never one this suite created. Playwright runs files in
 * alphabetical order, so inventory.e2e.test.ts has already put its own item
 * through the lifecycle by the time this runs.
 */
async function seededItem(): Promise<{ id: string; name: string }> {
  const { db, close } = openDb();
  try {
    const [item] = await db
      .select({
        id: schema.inventoryItems.id,
        name: schema.inventoryItems.name,
      })
      .from(schema.inventoryItems)
      // Exclude both suites' fixtures, not just this one's. The accessibility
      // suite seeds "A11Y Test Item", which sorts first and is `available`,
      // while CI runs the two suites on separate databases so only the dev
      // seed is present there. That divergence is what made this test pass
      // locally and fail in CI: the two environments picked different rows.
      .where(
        and(
          not(like(schema.inventoryItems.name, `${E2E_PREFIX}%`)),
          not(ilike(schema.inventoryItems.name, "a11y%"))
        )
      )
      .orderBy(schema.inventoryItems.name)
      .limit(1);
    if (!item) {
      throw new Error(
        "no seeded inventory item in the database. Run: npm run db:seed:dev"
      );
    }
    return item;
  } finally {
    await close();
  }
}
