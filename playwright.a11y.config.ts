import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './src/test/a11y',
  testMatch: '**/*.a11y.test.ts',
  retries: 0,
  globalSetup: './src/test/a11y/global-setup.ts',
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report/a11y', open: 'never' }],
  ],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium-light',
      use: { ...devices['Desktop Chrome'], colorScheme: 'light' },
    },
    {
      name: 'chromium-dark',
      use: { ...devices['Desktop Chrome'], colorScheme: 'dark' },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
