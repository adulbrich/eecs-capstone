import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";

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
      // On, as in production, so every lister test that writes through a
      // `*As` function and then lists is also a test that the write cleared
      // the cache (#558). `resetDatabase()` clears it between tests.
      REFERENCE_LIST_CACHE_TTL_MS: "60000",
    },
  },
});
