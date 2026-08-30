import { defineConfig, devices } from "@playwright/test";
import { config as loadDotenv } from "dotenv";
import { BASE_URL, PORT, SERVER_LOG_RELATIVE } from "./src/test/e2e/constants";

// `npm run start` is plain `node .output/server/index.mjs` with no --env-file,
// unlike the dev server, which gets .env.local for free through Vite. Playwright
// passes its own process.env down to webServer, so loading it here is what gives
// the production server a DATABASE_URL. Without it the server still boots and
// still binds the port, then answers 500 on every route, which reads like an app
// bug rather than a missing variable.
loadDotenv({ path: [".env.local", ".env"] });

export default defineConfig({
  testDir: "./src/test/e2e",
  testMatch: "**/*.e2e.test.ts",
  globalSetup: "./src/test/e2e/global-setup.ts",

  // A hang catcher, not a budget. The smoke set is meant to finish inside a
  // 5-minute CI job, but that budget is enforced by reading the job duration,
  // not by failing the run: two identical CI runs of the accessibility suite
  // took 2m31s and 3m33s, so a timeout sized to the budget would go red on a
  // slow runner rather than on a broken test. This number exists to kill a
  // wedged browser or a server that never came up.
  globalTimeout: 8 * 60 * 1000,

  // One retry in CI, none locally. Zero would let a single Vite or runner
  // hiccup block every open pull request; two would let a test that passes
  // 60% of the time look green forever. A smoke test that flakes twice gets
  // fixed or demoted to the full suite, never retried harder.
  retries: process.env.CI ? 1 : 0,

  // Serial. A 2-core runner already hosts Postgres, object storage, a Node
  // server and a browser; a second worker usually costs more in flake than it
  // returns in wall clock. The per-attempt fixtures in fixtures.ts would allow
  // parallelism, and that is the knob to turn if the budget ever binds.
  workers: 1,

  reporter: [
    ["list"],
    ["html", { outputFolder: "playwright-report/e2e", open: "never" }],
  ],

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",

    // Without this a stuck click is bounded only by the test timeout, so a
    // whole flow dies with "Test timeout of 30000ms exceeded" and names no
    // locator. Ten seconds is far above any real interaction here and turns a
    // hang into a message that says which control was not found.
    actionTimeout: 10_000,
  },

  // Chromium only. Cross-engine and mobile-viewport coverage belong to the full
  // suite, which has no time budget to answer to.
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  webServer: {
    // Builds every run. The point of this suite is the production output: the
    // dev server cannot see SSR-only breakage, a broken production chunk, or a
    // VITE_ variable that failed to inline. The build costs a few seconds.
    // Teed rather than piped straight through. The console email transport
    // writes to stderr and nothing stores its links, so the account-lifecycle
    // test reads them back out of this file; `tee` truncates on open, so each
    // run starts from an empty log. Playwright still gets its copy through the
    // pipe below.
    command: `npm run build && npm run start 2>&1 | tee ${SERVER_LOG_RELATIVE}`,

    // /api/healthz, because readiness should not depend on a page rendering:
    // it is a fixed text response with no data behind it.
    //
    // Do not read that route's source and conclude this cannot catch a missing
    // DATABASE_URL. The handler returns a hardcoded 200 and deliberately avoids
    // the database, for the ALB's sake. But `src/db/index.ts` throws at module
    // scope, so in the built server a missing DATABASE_URL fails the whole SSR
    // graph and every route answers 500, healthz included, while the process
    // stays up and bound. Measured: both / and /api/healthz return 500.
    //
    // That is what makes this a real gate. Playwright waits for 2xx or 3xx, so
    // a misconfigured server never goes ready and the run fails as "server did
    // not start" rather than as five confusing test failures.
    url: `${BASE_URL}/api/healthz`,

    // Never reuse, in CI or locally. A dev server left running would otherwise
    // substitute the dev build for the production build this suite exists to
    // exercise, and report green.
    reuseExistingServer: false,

    timeout: 180_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      PORT: String(PORT),
      // Must track PORT: Better Auth checks the request origin against this,
      // and a mismatch fails sign-in for a reason that looks nothing like a
      // port problem.
      BETTER_AUTH_URL: BASE_URL,
      // Publishing a project awaits a Titan embedding call. The flag is the
      // same one vitest.integration.config.ts sets; what it saves is not model
      // latency but the AWS credential-chain walk, which probes IMDS with
      // retries on a runner that has no instance metadata.
      BEDROCK_EMBEDDINGS_ENABLED: "false",
    },
  },
});
