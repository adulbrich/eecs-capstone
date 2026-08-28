import { describe, expect, it } from "vitest";
import { embeddingsEnabled } from "#/lib/_internal/embeddings-flag";

describe("the embeddings kill switch", () => {
  it("is enabled unless explicitly switched off", () => {
    expect(embeddingsEnabled()).toBe(true);
  });

  it("reads the env on every call, not once at import", () => {
    // As a module-level const this depended on import order and on nothing
    // replacing process.env. A kill switch that can fail open by accident is
    // not a kill switch, and when it fails open under test the call reaches
    // the AWS SDK and pays an IMDS probe with retries rather than erroring.
    const original = process.env.BEDROCK_EMBEDDINGS_ENABLED;
    try {
      process.env.BEDROCK_EMBEDDINGS_ENABLED = "false";
      expect(embeddingsEnabled()).toBe(false);
      process.env = { ...process.env };
      expect(embeddingsEnabled()).toBe(false);
      delete process.env.BEDROCK_EMBEDDINGS_ENABLED;
      expect(embeddingsEnabled()).toBe(true);
    } finally {
      if (original === undefined) {
        delete process.env.BEDROCK_EMBEDDINGS_ENABLED;
      } else {
        process.env.BEDROCK_EMBEDDINGS_ENABLED = original;
      }
    }
  });
});
