import { afterEach, beforeEach } from "vitest";
import { resetDatabase } from "./db-reset";

/**
 * Fail if the embedding kill switch is open.
 *
 * `vitest.integration.config.ts` sets `BEDROCK_EMBEDDINGS_ENABLED=false`, but
 * nothing checked that it arrived. A fail-open is expensive rather than merely
 * wrong; the docblock on `embeddingsEnabled` in
 * `src/lib/_internal/bedrock-embed.ts` explains why, and #22 is the flake it
 * presented as.
 *
 * The expression is duplicated from that module rather than imported, because
 * importing it pulls `@aws-sdk/client-bedrock-runtime` in at the top level,
 * which is 109ms every integration file would pay in its own fork to run one
 * string compare. Keep the two in step.
 */
function embeddingsEnabled(): boolean {
  return process.env.BEDROCK_EMBEDDINGS_ENABLED !== "false";
}

function assertEmbeddingsDisabled(when: string) {
  if (embeddingsEnabled()) {
    throw new Error(
      `Embeddings are enabled during the integration run (${when}). BEDROCK_EMBEDDINGS_ENABLED must be "false"; anything else, including unset, is on.`
    );
  }
}

// The config never set it, or the line was deleted. Checked here so the failure
// arrives once per file at collection, naming the cause, rather than as N
// identical test failures. This is a reporting choice, not extra coverage: the
// afterEach below would catch it too.
assertEmbeddingsDisabled("at collection");

beforeEach(async () => {
  await resetDatabase();
});

// A test replaced `process.env`, which is the fail-open #22 actually names and
// the one PR #21's read-per-call fix does not close. Checked after rather than
// before, so the failure lands on the test that did it: a beforeEach would pass
// the blame to the innocent next test, and would never catch the last test in a
// file at all.
afterEach(() => {
  assertEmbeddingsDisabled("after a test mutated the environment");
});
