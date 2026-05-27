import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export async function checkA11y(page: Page): Promise<void> {
  // Use 'load' rather than 'networkidle': the Vite dev-server keeps an HMR
  // WebSocket open indefinitely, so networkidle never fires locally.
  // Note: this only guarantees the initial SSR page load is scanned. Tests
  // using in-page navigation after goto() should await a page-specific sentinel
  // element before calling checkA11y.
  await page.waitForLoadState('load', { timeout: 15_000 });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();

  if (results.violations.length > 0) {
    const summary = results.violations.map((v) => ({
      rule: v.id,
      impact: v.impact,
      elements: v.nodes.map((n) => n.html),
    }));
    expect(summary, `axe violations:\n${JSON.stringify(summary, null, 2)}`).toEqual([]);
  }
}
