import type { Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import { and, ilike, like, not } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { waitForHydration } from "../shared/playwright";
import { ADMIN_AUTH, USER_AUTH } from "./constants";
import {
  createFixtureUser,
  deleteFixtureUser,
  E2E_PREFIX,
  openDb,
  withDb,
} from "./fixtures";
import { enterEmailedCode } from "./mail";

/**
 * A signed-out visitor is sent to sign in and back; a signed-in one without
 * the role gets the access-denied page at the URL they asked for, with a 403
 * (#606). The public detail routes render their staff panels on a role check
 * with no route guard at all. All three are browser behaviors, which is why
 * they live here rather than in the integration suite: a status on a rendered
 * page is not something a server-function test can observe, and a
 * conditionally rendered panel is only absent in a real render.
 */
test.describe("@smoke authorization", () => {
  test("sends an anonymous visitor to sign-in with a return path", async ({
    page,
  }) => {
    await page.goto("/admin/projects");
    const signIn = new URL(page.url());
    expect(signIn.pathname).toBe("/sign-in");
    expect(returnPath(signIn).pathname).toBe("/admin/projects");
  });

  test("brings the query string back through sign-in", async ({ page }) => {
    // A filtered admin list has to come back filtered (#606). Before, only
    // the path made the trip. The router fills in the page's search defaults
    // before `_authed` sees the URL, so the return path carries those too;
    // the one that matters is the one the visitor chose.
    await page.goto("/admin/projects?q=robotics");
    const signIn = new URL(page.url());
    expect(signIn.pathname).toBe("/sign-in");
    const back = returnPath(signIn);
    expect(back.pathname).toBe("/admin/projects");
    expect(back.searchParams.get("q")).toBe("robotics");

    await waitForHydration(page);
    await enterEmailedCode(page, "admin@example.com");
    await page.waitForURL((url) => url.pathname === "/admin/projects", {
      timeout: 15_000,
    });
    expect(new URL(page.url()).searchParams.get("q")).toBe("robotics");
    await expect(page.getByRole("searchbox")).toHaveValue("robotics");
  });

  test("tells a signed-in non-staff user where they are and what it needs", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: USER_AUTH });
    try {
      const page = await context.newPage();
      const response = await page.goto("/admin/projects");
      // Refused in place: the URL stays for them to report, and the status
      // says what the page does.
      expect(response?.status()).toBe(403);
      expect(new URL(page.url()).pathname).toBe("/admin/projects");
      // After hydration, because the refusal crosses from the server render
      // to the browser, and a shape that did not survive would turn this
      // into the generic error page once React took over.
      await waitForHydration(page);
      await expectRefusal(page, "user@example.com", "a staff role");
    } finally {
      await context.close();
    }
  });

  test("tells staff who are not admins that /admin/users needs an admin", async ({
    browser,
  }) => {
    const instructor = await withDb((db) =>
      createFixtureUser(db, { role: "instructor" })
    );
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      await page.goto("/sign-in");
      await waitForHydration(page);
      await enterEmailedCode(page, instructor.email);
      await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

      // Staff, so the admin pages open for them.
      const admin = await page.goto("/admin");
      expect(admin?.status()).toBe(200);

      const response = await page.goto("/admin/users");
      expect(response?.status()).toBe(403);
      expect(new URL(page.url()).pathname).toBe("/admin/users");
      await expectRefusal(page, instructor.email, "an admin role");
    } finally {
      await context.close();
      await withDb((db) => deleteFixtureUser(db, instructor.id));
    }
  });

  test("shows the public item page staff panels to staff and nobody else", async ({
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
      // The heading, not an add button. Whether "Borrow" renders depends
      // on the item's status, and the seed leaves its alphabetically first item
      // `requested`, which shows "This item is not available right now" and no
      // button at all. A sentinel for "did this page render" must not itself be
      // conditional.
      await expect(
        page.getByRole("heading", { level: 1, name: item.name })
      ).toBeVisible();

      // InventoryPrivatePanel and StaffInventoryPanel both hang off
      // detail.viewerIsStaff, with nothing in the route to enforce it. Assert
      // their PanelHeader h2s rather than any staff action: which action the
      // panel offers depends on the item's status, so the absence of a button
      // named "Check out" would prove nothing for an item the seed leaves
      // `requested`, where even staff are offered "Approve / reserve".
      await expect(
        page.getByRole("heading", { name: "Private", exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByRole("heading", { name: "Staff panel", exact: true })
      ).toHaveCount(0);
    } finally {
      await context.close();
    }

    // An assertion that something is absent is worth exactly as much as the
    // proof it could have been present. Same URL, staff session, both panels.
    const staffContext = await browser.newContext({ storageState: ADMIN_AUTH });
    try {
      const staff = await staffContext.newPage();
      await staff.goto(`/inventory/${item.id}`);
      await expect(
        staff.getByRole("heading", { name: "Private", exact: true })
      ).toBeVisible();
      await expect(
        staff.getByRole("heading", { name: "Staff panel", exact: true })
      ).toBeVisible();
    } finally {
      await staffContext.close();
    }
  });
});

/** Where `/sign-in` will send the visitor back to, as a URL on this site. */
function returnPath(signIn: URL): URL {
  return new URL(signIn.searchParams.get("redirect") ?? "", signIn.origin);
}

/** The access-denied page, naming the account and the role the page needs. */
async function expectRefusal(
  page: Page,
  email: string,
  role: string
): Promise<void> {
  await expect(
    page.getByRole("heading", { level: 1, name: "You do not have access" })
  ).toBeVisible();
  await expect(page.getByText(`You are signed in as ${email}.`)).toBeVisible();
  await expect(page.getByText(`This page needs ${role}.`)).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Browse projects" })
  ).toHaveAttribute("href", "/projects");
}

/**
 * A seeded item, never a fixture from either Playwright suite. Both filters
 * matter for the same reason: this has to pick the same row in every
 * environment. Locally the suites share a database and the accessibility
 * suite's "A11Y Test Item" sorts first and is `available`; in CI they get
 * separate databases and it does not exist. That divergence is what once made
 * this test pass locally and fail in CI, on two different rows.
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
