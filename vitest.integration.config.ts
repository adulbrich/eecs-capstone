import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";

// Here at config load, not in setupFiles: `src/db/index.ts` throws at import
// without DATABASE_URL, and setupFiles' own static imports reach it before any
// call in its body runs.
loadDotenv({ path: [".env.local", ".env"] });

export default defineConfig({
  resolve: {
    alias: {
      "#": fileURLToPath(new URL("./src/", import.meta.url)),
    },
  },
  test: {
    include: ["src/**/*.integration.test.ts"],
    setupFiles: ["src/test/setup.integration.ts"],
    pool: "forks",
    fileParallelism: false,
    // Embeddings must never reach AWS from a test. Tests that need a vector
    // inject their own EmbedFn; everything else fails fast and locally.
    env: {
      BEDROCK_EMBEDDINGS_ENABLED: "false",
      BEDROCK_SOCIAL_SUMMARY_ENABLED: "false",
      // On, as in production, so project-filter-options.integration.test.ts
      // can show a staff write clearing the listing's cache (#558).
      // `resetDatabase()` clears it between tests.
      REFERENCE_LIST_CACHE_TTL_MS: "60000",
    },
  },
});
