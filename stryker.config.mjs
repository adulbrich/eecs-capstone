// Mutation testing, advisory only (#843). Run with `npm run test:mutation`;
// the HTML report lands in `reports/mutation/`.
import { execFileSync } from "node:child_process";

// Stryker copies the project into a sandbox and reads neither `.gitignore`
// nor `.git/info/exclude`, so this asks git what it ignores rather than
// keeping a second list by hand. A hand list here missed the main checkout's
// `infra/.terraform`, hundreds of megabytes with a state file, and its
// `terraform.tfvars`. Copying everything git tracks, rather than `src` alone,
// is deliberate: the related tests read `drizzle/` and the like at run time.
const gitIgnored = execFileSync(
  "git",
  [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
  ],
  { encoding: "utf8" }
)
  .split("\0")
  .filter(Boolean)
  .map((path) => `/${path}`);

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
  ignorePatterns: gitIgnored,
  reporters: ["clear-text", "progress", "html", "json"],
  // Advisory: a low score never fails the run.
  thresholds: { high: 80, low: 60, break: null },
};
