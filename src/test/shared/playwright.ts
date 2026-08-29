/**
 * Playwright utilities shared by the accessibility suite and the end-to-end
 * suite. Both drive the same app through the same hydration and Radix
 * behaviors, so these live here rather than being copied per suite.
 */
import type { Browser, Page } from "@playwright/test";
import { chromium, expect } from "@playwright/test";

/** The password scripts/seed-dev.ts sets on every seeded user. */
export const SEED_PASSWORD = "password";

/**
 * Waits for React to attach its event listeners before a test interacts with
 * the page. The server-rendered markup (including buttons) is present and
 * "actionable" the moment `load` fires, but React hasn't necessarily
 * hydrated yet: a click that lands in that window reaches a button with no
 * listener attached and silently does nothing. Poll for React's internal
 * fiber keys on a concrete element instead of guessing at a timeout.
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
      const element = document.querySelector(sel);
      if (!element) {
        return false;
      }
      return Object.keys(element).some(
        (k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")
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
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"), {
      timeout: 15_000,
    });
    await context.storageState({ path: outputPath });
  } finally {
    await browser?.close();
  }
}
