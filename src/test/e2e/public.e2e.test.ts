import { expect, test } from "@playwright/test";
import { and, eq, like, not } from "drizzle-orm";
// biome-ignore lint/performance/noNamespaceImport: drizzle needs the schema namespace object
import * as schema from "../../db/schema";
import { E2E_PREFIX, openDb } from "./fixtures";

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

    // The one page a prospective student reads before deciding to sign up.
    // The accessibility scan of /privacy proves nothing here: a redirect to
    // /sign-in is axe-clean too. Only the heading says the route is public.
    await page.goto("/privacy");
    await expect(
      page.getByRole("heading", { name: "Privacy", exact: true })
    ).toBeVisible();

    // TanStack Router normalizes search params with a 307 before rendering, so
    // /projects lands on /projects?q=&categories=%5B%5D&... Match the path and
    // let the query string be whatever the route's defaults are.
    await page.goto("/projects");
    await expect(page).toHaveURL(/\/projects\?/);
    // The URL alone proves nothing: a 307 to the normalized search params
    // followed by an error boundary would satisfy it, which is the
    // production-build failure this test exists to catch. A link into a
    // project detail page only exists if the list rendered rows, where a bare
    // getByRole("link") would be satisfied by the site header.
    await expect(page.locator('a[href^="/projects/"]').first()).toBeVisible();

    const { db, close } = openDb();
    let publishedId: string;
    let publishedTitle: string;
    try {
      const [published] = await db
        .select({ id: schema.projects.id, title: schema.projects.title })
        .from(schema.projects)
        // Never an E2E- row. Playwright runs files alphabetically, so
        // projects.e2e.test.ts has already published one of its own by now,
        // and a bare limit(1) with no ORDER BY would let row order decide
        // whether this test asserts against another file's fixture.
        .where(
          and(
            eq(schema.projects.status, "published"),
            not(like(schema.projects.title, `${E2E_PREFIX}%`))
          )
        )
        .orderBy(schema.projects.title)
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
