import { beforeEach } from "vitest";
import { embeddingsEnabled } from "#/lib/_internal/bedrock-embed";
import { resetDatabase } from "./db-reset";

/**
 * Fail the run, not one case, if the embedding kill switch is open.
 *
 * `vitest.integration.config.ts` sets `BEDROCK_EMBEDDINGS_ENABLED=false`, but
 * nothing checked that it arrived. When it fails open there is no fast error:
 * the call reaches the AWS SDK, which walks the credential chain and pays an
 * IMDS probe with retries, so a case takes seconds instead of milliseconds and
 * looks like flakiness rather than misconfiguration. That is the profile of
 * #22, which failed 2 of 6 full-suite runs at roughly 11s against 1.2s in
 * isolation.
 *
 * Checked here rather than trusted from the config because the config is one
 * deleted line away from silent, and because `loadDotenv` runs in that same
 * file: a `.env.local` copied from `.env.example`, which ships
 * `BEDROCK_EMBEDDINGS_ENABLED=true`, is a plausible way for the value to
 * change without anyone editing the test setup.
 */
if (embeddingsEnabled()) {
  throw new Error(
    "Embeddings are enabled during the integration run. Set BEDROCK_EMBEDDINGS_ENABLED=false; see the env block in vitest.integration.config.ts."
  );
}

beforeEach(async () => {
  await resetDatabase();
});
