import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./src/test/a11y",
  testMatch: "**/*.a11y.test.ts",
  // Zero locally, so a flake stays visible to whoever is writing the test.
  // Two in CI, because this suite drives a real dev server and a real browser
  // on a shared runner: a transient `[vite] Internal server error: socket hang
  // up` once turned a passing suite red by leaving Vite's error overlay over
  // the page, which then intercepted a click. Retried tests are reported as
  // flaky rather than silently swallowed, so a genuine intermittent bug still
  // surfaces in the log.
  retries: process.env.CI ? 2 : 0,
  globalSetup: "./src/test/a11y/global-setup.ts",
  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/a11y", open: "never" }],
  ],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium-light",
      use: { ...devices["Desktop Chrome"], colorScheme: "light" },
    },
    {
      name: "chromium-dark",
      use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
    },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
