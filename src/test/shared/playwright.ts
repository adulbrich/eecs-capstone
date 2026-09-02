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
