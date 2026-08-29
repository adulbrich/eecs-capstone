import { expect, test } from "@playwright/test";
import { eq } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { openDb } from "./fixtures";

/**
 * The only test in the smoke set that runs with no auth cookie at all.
 *
 * It is not made redundant by the flows that load pages later: server-rendering
 * a public page for an anonymous visitor is its own path, and it is the path a
 * prospective student hits first. This is also the test that would catch a
 * production build that boots but cannot render.
 */
test.describe("@smoke public shell", () => {
  test("renders the landing page, the project list, and a published project", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("banner")).toBeVisible();

    // TanStack Router normalizes search params with a 307 before rendering, so
    // /projects lands on /projects?q=&categories=%5B%5D&... Match the path and
    // let the query string be whatever the route's defaults are.
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/projects\?/);

    const { db, close } = openDb();
    let publishedId: string;
    let publishedTitle: string;
    try {
      const [published] = await db
        .select({ id: schema.projects.id, title: schema.projects.title })
        .from(schema.projects)
        .where(eq(schema.projects.status, "published"))
        .limit(1);
      if (!published) {
        throw new Error(
          "no published project in the database. Run: npm run db:seed:dev"
        );
      }
      publishedId = published.id;
      publishedTitle = published.title;
    } finally {
      await close();
    }

    await page.goto(`/projects/${publishedId}`);
    await expect(
      page.getByRole("heading", { name: publishedTitle })
    ).toBeVisible();

    // The detail route is public and renders its owner and staff panels on a
    // role check rather than behind a route guard, so the only proof they stay
    // hidden is to load the page as nobody and look.
    await expect(
      page.getByRole("heading", { name: "Private", exact: true })
    ).toHaveCount(0);
  });
});
