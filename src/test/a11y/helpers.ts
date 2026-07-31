import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Waits for React to attach its event listeners before a test interacts with
 * the page. The server-rendered markup (including buttons) is present and
 * "actionable" the moment `load` fires, but React hasn't necessarily
 * hydrated yet: a click that lands in that window reaches a button with no
 * listener attached and silently does nothing. Same technique as the sign-in
 * wait in global-setup.ts: poll for React's internal fiber keys on a
 * concrete element instead of guessing at a timeout.
 */
export async function waitForHydration(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const button = document.querySelector("button");
      if (!button) {
        return false;
      }
      return Object.keys(button).some(
        (k) => k.startsWith("__reactFiber") || k.startsWith("__reactProps")
      );
    },
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

export async function checkA11y(page: Page): Promise<void> {
  // Use 'load' rather than 'networkidle': the Vite dev-server keeps an HMR
  // WebSocket open indefinitely, so networkidle never fires locally.
  // Note: this only guarantees the initial SSR page load is scanned. Tests
  // using in-page navigation after goto() should await a page-specific sentinel
  // element before calling checkA11y.
  await page.waitForLoadState("load", { timeout: 15_000 });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();

  if (results.violations.length > 0) {
    const summary = results.violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      elements: v.nodes.map((n) => n.html),
    }));
    expect(
      summary,
      `axe violations:\n${JSON.stringify(summary, null, 2)}`
    ).toEqual([]);
  }
}
