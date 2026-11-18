import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const SENTRY_PACKAGE = /^@sentry\//u;

const config = defineConfig(({ mode }) => ({
  resolve: { tsconfigPaths: true },
  // The placement solver's worker imports `highs` only when a run starts, so
  // the dev server would discover it then, re-optimize, and reload the page
  // mid-run. Pre-bundling it at startup avoids the reload (#649).
  optimizeDeps: { include: ["highs"] },
  plugins: [
    devtools(),
    // Not under Vitest (`mode` is "test"; `process.env.VITEST` would leak into
    // a child process a test spawns). Alongside `tanstackStart()`, Nitro's dev
    // worker imports Start's SSR entry, whose `react` import is a CommonJS
    // file that Vitest leaves un-pre-bundled and the worker evaluates as ESM,
    // so every run printed `ReferenceError: module is not defined` and still
    // passed. No unit test reads anything Nitro produces: tests import the
    // `src/lib/_internal` logic the `src/nitro/*.ts` plugins call, never the
    // plugins.
    mode !== "test" &&
      nitro({
        compressPublicAssets: true,
        plugins: [
          "./src/nitro/config-check.ts",
          "./src/nitro/keep-alive-timeout.ts",
          "./src/nitro/asset-error-headers.ts",
          "./src/nitro/staff-edit-email-sweep.ts",
        ],
        rollupConfig: { external: [SENTRY_PACKAGE] },
      }),
    tailwindcss(),
    tanstackStart(),
    viteReact(),
  ],
  test: {
    // Scoped the way `vitest.integration.config.ts` scopes its own include,
    // and for a sharper reason than tidiness: an agent worktree checked out
    // under `.claude/worktrees/` is a second copy of this repo inside the
    // root, and vitest's default include walks straight into it. Every test
    // there runs against that worktree's own `node_modules`, so a stale or
    // half-installed one turns the pre-push unit gate red over code that is
    // not on the branch being pushed. Every test this project owns is under
    // `src/`.
    include: ["src/**/*.{test,spec}.?(c|m)[jt]s?(x)"],
  },
}));

export default config;
