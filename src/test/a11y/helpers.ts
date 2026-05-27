import { expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

export async function checkA11y(page: Page): Promise<void> {
  // Use 'load' rather than 'networkidle': the Vite dev-server keeps an HMR
  // WebSocket open indefinitely, so networkidle never fires locally.
  await page.waitForLoadState('load', { timeout: 15_000 });
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  expect(results.violations).toEqual([]);
}
