import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Stryker's own Vitest config (#843). `vite.config.ts` loads nitro,
// `tanstackStart` and devtools, none of which a unit test needs and each of
// which Stryker would start again in every worker. No `pool` here: the
// Stryker runner supports threads only.
//
// The include is the whole unit suite, the same set `npm test` runs, and not
// just each module's own test file. The Stryker runner's `related` option
// narrows a run to the test files that import a mutated module, so the wide
// include costs nothing, and the narrow one reported false survivors: an
// unanchored `GUARDED` in `csv.ts` passes `csv.test.ts` and fails the
// placement tests that reach it through `placementCsv`.
export default defineConfig({
  resolve: {
    alias: {
      "#": fileURLToPath(new URL("./src/", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
    setupFiles: ["src/test/setup.stryker.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/*.integration.test.ts",
      "**/*.a11y.test.ts",
      "**/*.e2e.test.ts",
    ],
  },
});
