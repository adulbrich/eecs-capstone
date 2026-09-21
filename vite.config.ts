import tailwindcss from "@tailwindcss/vite";
import { devtools } from "@tanstack/devtools-vite";

import { tanstackStart } from "@tanstack/react-start/plugin/vite";

import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const config = defineConfig({
  resolve: { tsconfigPaths: true },
  plugins: [
    devtools(),
    nitro({
      compressPublicAssets: true,
      plugins: [
        "./src/nitro/config-check.ts",
        "./src/nitro/keep-alive-timeouts.ts",
        "./src/nitro/asset-error-headers.ts",
      ],
      rollupConfig: { external: [/^@sentry\//] },
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
});

export default config;
