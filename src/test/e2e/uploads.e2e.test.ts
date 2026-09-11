import type { Locator, Page } from "@playwright/test";
import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { waitForHydration } from "../shared/playwright";
import { OTHER_AUTH, USER_AUTH } from "./constants";
import {
  createFixtureProject,
  fixtureName,
  openDb,
  userIdByEmail,
} from "./fixtures";
import { confirmed, recordServerFunctionCalls } from "./waits";

/**
 * The two upload paths. The crop and save flows stay out of the smoke suite
 * because the crop drag is the likeliest thing in the app to flake on a
 * required check; the pick-and-cancel test below is in it, because it is the
 * part that broke in production and it never touches the drag.
 *
 * The project image is also the only coverage anywhere that proves
 * `VITE_STORAGE_PUBLIC_BASE` was inlined at build time. `src/lib/storage.ts`
 * falls back to `/storage`, which produces relative URLs that look right in the
 * markup and resolve to an origin serving nothing, so asserting the `src`
 * attribute alone would pass on exactly the build this is meant to catch. The
 * assertion is that the browser decoded the bytes.
 */
test.describe("project image upload", () => {
  test("owner uploads, crops, and the image renders on the detail page", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const { db, close } = openDb();
    let projectId: string;
    try {
      const proposerId = await userIdByEmail(db, "user@example.com");
      ({ id: projectId } = await createFixtureProject(db, {
        title,
        proposerId,
        status: "draft",
      }));
    } finally {
      await close();
    }

    const context = await browser.newContext({ storageState: USER_AUTH });
    try {
      const owner = await context.newPage();
      await owner.goto(`/projects/${projectId}/edit`);
      await waitForHydration(owner, "form");

      await pickImage(owner);
      await dragCrop(owner);
      await owner.getByRole("button", { name: "Use image" }).click();

      // The uploader is back to its idle state, which is how it says the crop
      // was rendered to a file rather than abandoned.
      await expect(
        owner.getByRole("button", { name: "Replace image" })
      ).toBeVisible();

      await owner.getByRole("button", { name: "Save" }).click();
      await owner.waitForURL(new RegExp(`/projects/${projectId}$`), {
        timeout: 15_000,
      });

      // Scoped by the key prefix, not by a landmark: only the landing page
      // wraps its content in `<main>`. The header renders the signed-in user's
      // own avatar from this same origin, so a match on the origin alone can be
      // satisfied by an avatar while the project image never loads at all.
      // Storage keys are `projects/<id>/<uuid>.webp` and `avatars/<id>/...`,
      // which separates the two without depending on the page's structure.
      const image = owner.locator(`img[src^="${storageBase()}/projects/"]`);
      await expect(image).toBeVisible();
      await expectDecoded(image);
    } finally {
      await context.close();
    }
  });
});

/**
 * The regression that took the edit page down: the uploader's buttons were
 * `Button` with no `type`, which inside a form is a submit button. Clicking
 * "Upload image" opened the file picker and saved the form underneath it, and
 * the save's success handler navigated to the detail page. The crop is never
 * confirmed here, so the drag the header warns about is not in this test.
 *
 * The assertion is on what the save would have done, not on the crop UI: the
 * crop renders in milliseconds and the save round trip takes hundreds, so a
 * test that only checked for "Use image" would pass on the broken build. The
 * submit fires at click time, so the server function call it makes is on
 * record before the file chooser has even answered; the URL check behind it
 * catches the navigation the save's success handler would make.
 */
test.describe("@smoke project image pick", () => {
  test("picking an image keeps the owner on the edit page", async ({
    browser,
  }) => {
    const title = fixtureName("Project");
    const { db, close } = openDb();
    let projectId: string;
    try {
      const proposerId = await userIdByEmail(db, "user@example.com");
      ({ id: projectId } = await createFixtureProject(db, {
        title,
        proposerId,
        status: "draft",
      }));
    } finally {
      await close();
    }

    const context = await browser.newContext({ storageState: USER_AUTH });
    try {
      const owner = await context.newPage();
      await owner.goto(`/projects/${projectId}/edit`);
      await waitForHydration(owner, "form");

      const editUrl = new RegExp(`/projects/${projectId}/edit$`);
      const serverCalls = recordServerFunctionCalls(owner);

      await pickImage(owner);
      await expect(
        owner.getByRole("button", { name: "Use image" })
      ).toBeVisible();
      expect(serverCalls).toEqual([]);
      await expect(owner).toHaveURL(editUrl);

      // Cancel was a submit button too, so it gets the same check.
      await owner.getByRole("button", { name: "Cancel" }).click();
      await expect(
        owner.getByRole("button", { name: "Upload image" })
      ).toBeVisible();
      expect(serverCalls).toEqual([]);
      await expect(owner).toHaveURL(editUrl);
    } finally {
      await context.close();
    }
  });
});

/**
 * The avatar, which unlike the project image is written the moment the crop is
 * confirmed rather than on a form submit.
 *
 * Driven as the second seeded student on purpose. This writes to a *seeded*
 * user row rather than a fixture one, and `user@example.com` is the account the
 * accessibility suite signs in as, so a run that died between the upload and
 * the clear would change what that suite scans.
 */
test.describe("avatar upload and clear", () => {
  test("a student sets an avatar and takes it off again", async ({
    browser,
  }) => {
    const context = await browser.newContext({ storageState: OTHER_AUTH });
    try {
      const page = await context.newPage();
      await page.goto("/profile");
      await waitForHydration(page);

      // Two surfaces, and they do not update together. The uploader's own
      // preview reads the route context, which `router.invalidate()` refreshes;
      // the header reads `authClient.useSession()`, which is Better Auth's
      // client-side session cache and which nothing on this page invalidates.
      // So the header is a full page load behind, and asserting it without a
      // reload fails against an app that saved the avatar correctly.
      //
      // The header is also the only place in the app that renders an avatar at
      // all. Nothing shows one user's avatar to another, so the issue's "visible
      // wherever the app shows it to others" has no surface to assert against
      // rather than a missing assertion.
      const preview = page.getByAltText("Current");
      const headerAvatar = page.locator(
        `header img[src^="${storageBase()}/avatars/"]`
      );
      await expect(preview).toHaveCount(0);
      await expect(headerAvatar).toHaveCount(0);

      await pickImage(page);
      await dragCrop(page);
      await confirmed(page, () =>
        page.getByRole("button", { name: "Use image" }).click()
      );

      // The preview is on screen, but it is not evidence on its own: the
      // uploader prefers its local blob URL over the stored one for as long as
      // a file is picked, so this exact assertion passes on a crop that was
      // never uploaded. That is why the click above waits for the server to
      // answer, and why the stored URL is asserted after a reload rather than
      // here.
      await expect(preview).toBeVisible();

      await page.reload();
      await waitForHydration(page);
      await expect(headerAvatar).toBeVisible();
      await expectDecoded(headerAvatar);

      await confirmed(page, () =>
        page.getByRole("button", { name: "Remove" }).click()
      );
      await expect(preview).toHaveCount(0);

      // Survives a reload: a preview disappearing looks the same whether the
      // column was cleared or the client merely forgot.
      await page.reload();
      await waitForHydration(page);
      await expect(preview).toHaveCount(0);
      await expect(headerAvatar).toHaveCount(0);
    } finally {
      await context.close();
    }
  });
});

/**
 * The base the built client was compiled with. Read from the environment the
 * Playwright config already loaded, which is the same value the build inlined,
 * so a mismatch between the two is what the assertions above catch.
 */
function storageBase(): string {
  const base = process.env.VITE_STORAGE_PUBLIC_BASE;
  if (!base) {
    throw new Error(
      "VITE_STORAGE_PUBLIC_BASE is unset, so the build has no storage origin to inline. Add it to .env.local."
    );
  }
  return base;
}

/**
 * Hands the hidden file input a generated PNG.
 *
 * Generated rather than committed: a binary fixture in the repo is a file
 * nobody can review, and sharp is already a dependency. 1200x800 is wide enough
 * that both aspect ratios (16:9 for a project, 1:1 for an avatar) crop to
 * something rather than failing to fit.
 */
async function pickImage(page: Page): Promise<void> {
  const png = await sharp({
    create: {
      width: 1200,
      height: 800,
      channels: 3,
      background: { r: 214, g: 96, b: 24 },
    },
  })
    .png()
    .toBuffer();

  // Through the button, not `setInputFiles` on the hidden input. This helper
  // used to set the input directly because Playwright can, and that is exactly
  // how a button that submitted the form on its way to the file picker reached
  // production unseen: no test ever clicked it. The click is the point.
  const chooser = page.waitForEvent("filechooser");
  await page
    .getByRole("button", { name: /Upload image|Replace image/ })
    .click();
  await (await chooser).setFiles({
    name: "e2e-upload.png",
    mimeType: "image/png",
    buffer: png,
  });
}

/**
 * Moves the crop selection, which react-image-crop centers at 80% width on
 * load. The drag is the interaction under test rather than a way to produce a
 * crop: "Use image" is already enabled by the default selection, so a test that
 * skipped this would never touch the drag handling at all.
 */
async function dragCrop(page: Page): Promise<void> {
  const region = page.locator(".ReactCrop img");
  await expect(region).toBeVisible();
  const box = await region.boundingBox();
  if (!box) {
    throw new Error("the crop image has no box, so it never laid out");
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  // In steps, because a single jump can land as a click rather than a drag.
  await page.mouse.move(centerX + 24, centerY + 16, { steps: 8 });
  await page.mouse.up();
}

/**
 * Asserts the browser actually decoded the image at that URL.
 *
 * `naturalWidth` is zero for an <img> whose src 404s, which is the difference
 * between "the markup points somewhere" and "the bytes came back".
 *
 * Polled rather than read once: decoding is asynchronous, so a single
 * `expect(await ...)` snapshots whatever was true the instant the element
 * appeared and fails on an image that was merely still loading.
 */
async function expectDecoded(image: Locator): Promise<void> {
  await expect
    .poll(
      () =>
        image.evaluate(
          (el) =>
            (el as HTMLImageElement).complete &&
            (el as HTMLImageElement).naturalWidth > 0
        ),
      { timeout: 10_000 }
    )
    .toBe(true);
}
