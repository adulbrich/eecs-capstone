/**
 * Playwright utilities shared by the accessibility suite and the end-to-end
 * suite. Both drive the same app through the same hydration and Radix
 * behaviors, so these live here rather than being copied per suite.
 */
import type { Browser, Locator, Page } from "@playwright/test";
import { chromium, expect } from "@playwright/test";

/** The password scripts/seed-dev.ts sets on every seeded user. */
export const SEED_PASSWORD = "password";

/**
 * Waits for React to attach its event listeners before a test interacts with
 * the page. The server-rendered markup (including buttons) is present and
 * "actionable" the moment `load` fires, but React hasn't necessarily
 * hydrated yet: a click that lands in that window reaches a button with no
 * listener attached and silently does nothing. Poll for React's internal
 * fiber keys on concrete elements instead of guessing at a timeout.
 *
 * Every match must carry the keys, not the first one. Route components are
 * code-split, so the root layout hydrates as soon as its chunk arrives while
 * the route's own content is still fetching modules; on a slow runner the
 * first button on the page (the header's) is live seconds before the last
 * one (a route's danger zone), and a click in between does nothing. See
 * "One hydrated button does not mean a hydrated page" in docs/QUIRKS.md.
 *
 * `selector` exists because the sign-in page has no button until its form
 * renders, so the storage-state capture waits on the form instead.
 */
export async function waitForHydration(
  page: Page,
  selector = "button"
): Promise<void> {
  await page.waitForFunction(
    (sel) => {
      // TanStack Devtools mounts a Solid tree under body: its trigger and
      // panel chrome never carry a fiber key, and the plugin panels inside
      // are React portals that hydrate on their own schedule. The host is
      // the body-level element holding the trigger's test id.
      const devtools = document
        .querySelector('[data-testid="tanstack_devtools"]')
        ?.closest("body > *");
      const elements = Array.from(document.querySelectorAll(sel)).filter(
        (element) => !devtools?.contains(element)
      );
      if (elements.length === 0) {
        return false;
      }
      return elements.every((element) =>
        Object.keys(element).some(
          (k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")
        )
      );
    },
    selector,
    { timeout: 15_000 }
  );
}

/**
 * Closes an open Radix dropdown menu (e.g. the Columns menu) and waits for
 * its content to actually leave the DOM. Radix's `Presence` keeps the
 * content mounted through its `animate-out` CSS transition, so a bare
 * `Escape` press leaves a closing-but-still-present, still-focused,
 * still-highlighted menu item behind for a few hundred milliseconds. A test
 * that presses Escape and immediately continues (clicking elsewhere,
 * reopening the same menu, or scanning with axe) can catch that transient
 * frame, which is a test-timing artifact, not a rendering bug.
 */
export async function closeMenu(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(
    0
  );
}

/**
 * Waits for an open Radix surface (a dialog, alert dialog, sheet or dropdown
 * menu) to finish entering, so a scan that follows sees its settled colours.
 * The enter side of the `closeMenu` transient: the content mounts with
 * `data-state="open"` and an `animate-in` CSS animation, and `toBeVisible`
 * is satisfied at that animation's first frame, where a `fade-in` has the
 * surface at partial opacity. axe sampling that frame reports a
 * `color-contrast` violation on a button whose settled colours pass, once in
 * a dozen runs, which is a timing artifact and not a rendering bug (#294).
 *
 * Takes the locator the test already holds, which for a Radix surface is the
 * animated content itself (`role="dialog"`, `role="alertdialog"` or
 * `role="menu"`). A modal's overlay fades in beside it, and Radix portals
 * the two as separate children of `document.body` rather than under a shared
 * wrapper, so the overlay is found by its `data-slot` instead of by walking
 * up from the content. Animations that never finish, such as a spinner, are
 * skipped, and so is a paused one, whose `finished` would never settle. The
 * wait looks again after each batch settles and returns only when a fresh
 * look finds nothing running or about to run, so an animation cancelled
 * under the wait (`finished` rejects then) leads to another look at whatever
 * replaced it rather than to a pass or a failure on its own. An enter
 * animation sampled before its first frame is play-pending, and the Web
 * Animations spec reports that as `running`, so it is waited on; only a
 * pause, pending or applied, reports `paused`.
 */
export async function waitForSurfaceSettled(surface: Locator): Promise<void> {
  await expect(surface).toHaveAttribute("data-state", "open");
  await surface.evaluate(async (element) => {
    const running = () => {
      const overlays = Array.from(
        document.querySelectorAll('[data-slot$="-overlay"][data-state="open"]')
      );
      return [element, ...overlays]
        .flatMap((node) => node.getAnimations({ subtree: true }))
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getTiming().iterations !==
              Number.POSITIVE_INFINITY
        );
    };
    for (let batch = running(); batch.length > 0; batch = running()) {
      await Promise.allSettled(batch.map((animation) => animation.finished));
    }
  });
}

/**
 * Asserts the page is no wider than its viewport, which is how a title row
 * or a card layout that does not fit a phone shows up: the document scrolls
 * sideways. `clientWidth`, not `innerWidth`, because the latter counts a
 * vertical scrollbar's gutter and would hide an overflow of up to that
 * width. Call it after `setViewportSize` and a fresh `goto` (#280, #297).
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/**
 * Toggles a column's checkbox in an `AdminDataTable` Columns menu and waits
 * for its columnheader to actually appear before moving on.
 * `onColumnVisibilityChange` derives its next state from the current
 * `hidden` prop, which only updates after the URL round-trip commits, so
 * firing the clicks back-to-back with nothing awaited between them drops all
 * but the last one. Confirming each toggle lands is what a real user waiting
 * to see the column would also, incidentally, do.
 */
export async function toggleColumnOn(page: Page, label: string): Promise<void> {
  await page.getByRole("menuitemcheckbox", { name: label }).click();
  await expect(
    page.getByRole("columnheader", { name: label, exact: true })
  ).toBeVisible();
}

/**
 * Signs in through the real form and writes the resulting cookies to
 * `outputPath`, so tests can start already authenticated instead of paying
 * for a sign-in each time. Driving the real form rather than seeding a
 * session row keeps this honest about Better Auth's cookie handling, at the
 * cost of one browser launch per role during global setup.
 */
export async function saveStorageState(options: {
  baseURL: string;
  email: string;
  password: string;
  outputPath: string;
}): Promise<void> {
  const { baseURL, email, password, outputPath } = options;
  let browser: Browser | undefined;

  try {
    browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(`${baseURL}/sign-in`, { waitUntil: "load" });
    await waitForHydration(page, "form");
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 15_000,
    });
    await context.storageState({ path: outputPath });
  } finally {
    await browser?.close();
  }
}
