import { beforeEach } from "vitest";
import { embeddingsEnabled } from "#/lib/_internal/embeddings-flag";
import { resetDatabase } from "./db-reset";

/**
 * Refuse to run with the embedding kill switch open.
 *
 * `vitest.integration.config.ts` sets `BEDROCK_EMBEDDINGS_ENABLED=false`, but
 * nothing checked that it arrived, and a fail-open is expensive rather than
 * merely wrong. The docblock on `embeddingsEnabled` says why. Note that unset
 * counts as open, so a deleted config line is enough.
 *
 * Checked once, at module scope, so a whole run fails at collection naming the
 * cause rather than every test failing separately. The flag lives in its own
 * module, so this costs no AWS SDK import.
 */
if (embeddingsEnabled()) {
  throw new Error(
    'Embeddings are enabled during the integration run. BEDROCK_EMBEDDINGS_ENABLED must be "false"; anything else, including unset, is on. See the env block in vitest.integration.config.ts.'
  );
}

beforeEach(async () => {
  await resetDatabase();
});
