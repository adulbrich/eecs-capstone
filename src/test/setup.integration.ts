import { beforeEach } from "vitest";
import { embeddingsEnabled } from "#/lib/_internal/embeddings-flag";
import { socialSummariesEnabled } from "#/lib/_internal/social-summary-flag";
import { settleProjectRefreshes } from "#/server/_internal/project-refresh";
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

/**
 * The same refusal for the social summary, which matters more: it runs on
 * every publish, archive and edit of a live project rather than behind a
 * button, so a fail-open would reach Bedrock from most of this suite.
 *
 * `project-social-summary.integration.test.ts` is the one file that turns it
 * back on, for itself, in a `beforeAll`. That file injects a fake
 * `ResponsesFn` into every path it exercises, including the `summarize` seam
 * on `performTransitionAs`, so it still reaches no network.
 */
if (socialSummariesEnabled()) {
  throw new Error(
    'Social summaries are enabled during the integration run. BEDROCK_SOCIAL_SUMMARY_ENABLED must be "false"; anything else, including unset, is on. See the env block in vitest.integration.config.ts.'
  );
}

beforeEach(async () => {
  // A save or publish returns before its embedding and summary refresh does,
  // so let the last test's refresh land before truncating under it.
  await settleProjectRefreshes();
  await resetDatabase();
});
