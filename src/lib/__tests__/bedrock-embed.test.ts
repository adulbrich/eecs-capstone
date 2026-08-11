import { describe, expect, it } from "vitest";
import {
  buildEmbedRequestBody,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  embeddingsEnabled,
  parseEmbedResponse,
} from "#/lib/_internal/bedrock-embed";

describe("buildEmbedRequestBody", () => {
  it("asks Titan for normalized vectors at the configured size", () => {
    const body = JSON.parse(buildEmbedRequestBody("robotics"));
    expect(body.inputText).toBe("robotics");
    expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(body.normalize).toBe(true);
  });
});

describe("parseEmbedResponse", () => {
  it("reads the embedding array out of the response payload", () => {
    const payload = new TextEncoder().encode(
      JSON.stringify({ embedding: [0.1, 0.2, 0.3], inputTextTokenCount: 3 })
    );
    expect(parseEmbedResponse(payload)).toEqual([0.1, 0.2, 0.3]);
  });

  it("throws when the payload has no embedding", () => {
    const payload = new TextEncoder().encode(JSON.stringify({ message: "no" }));
    expect(() => parseEmbedResponse(payload)).toThrow(
      "Bedrock returned no embedding"
    );
  });
});

describe("defaults", () => {
  it("targets Titan Text Embeddings V2 at 1024 dimensions", () => {
    expect(EMBEDDING_MODEL_ID).toBe("amazon.titan-embed-text-v2:0");
    expect(EMBEDDING_DIMENSIONS).toBe(1024);
  });

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
