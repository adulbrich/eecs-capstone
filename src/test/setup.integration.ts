import { afterEach, beforeEach } from "vitest";
import { embeddingsEnabled } from "#/lib/_internal/embeddings-flag";
import { resetDatabase } from "./db-reset";

/**
 * Fail if the embedding kill switch is open.
 *
 * `vitest.integration.config.ts` sets `BEDROCK_EMBEDDINGS_ENABLED=false`, but
 * nothing checked that it arrived, and a fail-open is expensive rather than
 * merely wrong. The docblock on `embeddingsEnabled` says why.
 *
 * The flag lives in its own module so this costs no AWS SDK import.
 */
function assertEmbeddingsDisabled(when: string) {
  if (embeddingsEnabled()) {
    throw new Error(
      `Embeddings are enabled during the integration run (${when}). BEDROCK_EMBEDDINGS_ENABLED must be "false"; anything else, including unset, is on.`
    );
  }
}

// The value never arrived, which is the case worth catching and the only one
// that can affect a whole run. Checked at module scope so it reports once per
// file at collection, naming the cause, rather than once per test.
assertEmbeddingsDisabled("at collection");

beforeEach(async () => {
  await resetDatabase();
});

// A test replaced `process.env` and did not put it back. This is narrower than
// it looks and the narrowness is the point: a test that mutates and restores in
// its own afterEach is invisible here, because vitest's `sequence.hooks`
// defaults to "stack" and runs the file's hook before this one. So it catches
// leaked state, not the transient mutation #22 describes, and it cannot see the
// call that already paid the IMDS probe inside the test body. It is a
// regression guard on a mode nothing exercises today, not a reproduction of the
// flake.
afterEach(() => {
  assertEmbeddingsDisabled("left enabled by a test");
});
