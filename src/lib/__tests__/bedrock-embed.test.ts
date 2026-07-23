import { describe, expect, it } from "vitest";
import {
  buildEmbedRequestBody,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  EMBEDDINGS_ENABLED,
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
    expect(EMBEDDINGS_ENABLED).toBe(true);
  });
});
