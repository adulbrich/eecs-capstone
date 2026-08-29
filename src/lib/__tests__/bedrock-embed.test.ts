import { describe, expect, it } from "vitest";
import {
  buildEmbedConfig,
  buildEmbedRequestBody,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  parseEmbedResponse,
} from "#/lib/_internal/bedrock-embed";

describe("buildEmbedRequestBody", () => {
  it("asks Titan for normalized vectors at the configured size", () => {
    const body = JSON.parse(buildEmbedRequestBody("robotics"));
    expect(body.inputText).toBe("robotics");
    expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(body.normalize).toBe(true);
  });

  it("asks for the default size when nothing is configured", () => {
    // The assertion above compares the request against the same constant that
    // built it, so it passes for any value including a wrong one. This is the
    // one that pins an actual number, which it can only do now that the
    // default is reachable from a literal environment.
    expect(buildEmbedConfig({} as NodeJS.ProcessEnv).dimensions).toBe(1024);
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
});
