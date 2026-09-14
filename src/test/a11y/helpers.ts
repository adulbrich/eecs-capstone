import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * A link inside running text is underlined at rest (UI-CONVENTIONS, "A link
 * inside running text"). axe has a rule for this, `link-in-text-block`, and
 * the scan runs it, but it cannot fail on ours: a link longer than the words
 * beside it is not "in text" by its heuristic, and where it does match, the
 * body's gradient makes the result "undeterminable", which lands in
 * `incomplete` and `checkA11y` reads `violations` alone. So the line is
 * asserted on the computed style instead. Call it before anything hovers or
 * focuses the link; `hover:underline` would pass afterwards.
 */
export async function expectUnderlinedAtRest(link: Locator): Promise<void> {
  await expect(link).toHaveCSS("text-decoration-line", "underline");
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
