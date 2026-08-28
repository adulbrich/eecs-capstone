import { beforeEach } from "vitest";
import { embeddingsEnabled } from "#/lib/_internal/bedrock-embed";
import { resetDatabase } from "./db-reset";

/**
 * Fail if the embedding kill switch is open.
 *
 * `vitest.integration.config.ts` sets `BEDROCK_EMBEDDINGS_ENABLED=false`, but
 * nothing checked that it arrived. When it fails open there is no fast error:
 * the call reaches the AWS SDK, which walks the credential chain and pays an
 * IMDS probe with retries, so a case takes seconds instead of milliseconds and
 * reads as flakiness rather than misconfiguration. See #22 and the docblock on
 * `embeddingsEnabled` for why that is expensive rather than merely wrong.
 *
 * Checked in two places because #22 names two ways it can fail open, and one
 * check cannot see both.
 */
function assertEmbeddingsDisabled() {
  if (embeddingsEnabled()) {
    throw new Error(
      "Embeddings are enabled during the integration run. Set BEDROCK_EMBEDDINGS_ENABLED=false; see the env block in vitest.integration.config.ts."
    );
  }
}

// Mode one: the config never set it. Deleting that one line is enough, and the
// variable is then unset rather than "true", which still fails open because
// `embeddingsEnabled` treats anything but the string "false" as on. Checked at
// module scope so this reports once per file at collection, naming the cause,
// instead of once per test.
assertEmbeddingsDisabled();

beforeEach(async () => {
  // Mode two: a test replaced `process.env`. PR #21 fixed the import-order
  // half of #22 by reading the variable per call, which leaves this half: a
  // value that was correct at collection can be wrong by the time a later case
  // runs, and only a per-test check sees that.
  assertEmbeddingsDisabled();
  await resetDatabase();
});
