// Mutation testing, advisory only (#843). Run with `npm run test:mutation`;
// the HTML report lands in `reports/mutation/`.

/** @type {import("@stryker-mutator/api/core").PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  // `related` runs only the test files that import a mutated module; the
  // Vitest config includes the whole unit suite and relies on it.
  vitest: { configFile: "vitest.stryker.config.ts", related: true },
  mutate: [
    "src/lib/csv.ts",
    "src/lib/same-origin-path.ts",
    "src/lib/social-meta.ts",
  ],
  // Stryker copies the project into a sandbox and reads neither `.gitignore`
  // nor `.git/info/exclude`, so without these it would copy build output,
  // reports, secrets and every agent worktree under `.claude/worktrees/`. A
  // denylist rather than `src` alone: the related tests read `drizzle/` and
  // the like at run time, so an allowlist fails the dry run whenever one
  // starts reading a new directory.
  ignorePatterns: [
    "/.claude/worktrees",
    "/.env*",
    "/.nitro",
    "/.output",
    "/.tanstack",
    "/playwright-report",
    "/reports",
    "/test-results",
  ],
  reporters: ["clear-text", "progress", "html", "json"],
  // Advisory: a low score never fails the run.
  thresholds: { high: 80, low: 60, break: null },
};
