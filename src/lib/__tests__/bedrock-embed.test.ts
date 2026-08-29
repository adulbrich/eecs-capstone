import { describe, expect, it } from "vitest";
import {
  buildEmbedConfig,
  buildEmbedRequestBody,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL_ID,
  parseEmbedResponse,
} from "#/lib/_internal/bedrock-embed";
import { embeddingHash } from "#/lib/embedding-source";

describe("buildEmbedRequestBody", () => {
  it("asks Titan for normalized vectors at the configured size", () => {
    const body = JSON.parse(buildEmbedRequestBody("robotics"));
    expect(body.inputText).toBe("robotics");
    expect(body.dimensions).toBe(EMBEDDING_DIMENSIONS);
    expect(body.normalize).toBe(true);
  });

  it("asks for the default size on any machine, not just one without a .env", () => {
    // The assertion above compares the request against the same constant that
    // built it, so it passes for any value including a wrong one. The
    // `defaults` case below does pin the number, but through the ambient
    // constant, so it only passes because `npm test` does not load
    // `.env.local`. This one reads a literal environment and holds regardless.
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

describe("buildEmbedConfig", () => {
  it("takes both from the environment when they are set", () => {
    expect(
      buildEmbedConfig({
        BEDROCK_EMBEDDING_DIMENSIONS: "256",
        BEDROCK_EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v1",
      } as NodeJS.ProcessEnv)
    ).toEqual({ dimensions: 256, modelId: "amazon.titan-embed-text-v1" });
  });

  it("yields zero dimensions for a blank value, which is the pre-existing wart", () => {
    // Number("") is 0, not the default, so a blank variable does not fall back.
    // Pinned rather than fixed: these two values are hashed into
    // projects.embedding_source_hash, so changing what an environment resolves
    // to invalidates every stored hash and re-embeds every project at one paid
    // Bedrock call each. See #137.
    expect(
      buildEmbedConfig({
        BEDROCK_EMBEDDING_DIMENSIONS: "",
      } as NodeJS.ProcessEnv).dimensions
    ).toBe(0);
  });

  it("feeds the hash that decides whether a project is re-embedded", () => {
    // The reason the two above matter. A different resolved value here is a
    // different hash for identical source text, which reads as "every project
    // changed" to refreshProjectEmbedding.
    const config = buildEmbedConfig({} as NodeJS.ProcessEnv);
    const same = buildEmbedConfig({
      BEDROCK_EMBEDDING_MODEL_ID: "amazon.titan-embed-text-v2:0",
      BEDROCK_EMBEDDING_DIMENSIONS: "1024",
    } as NodeJS.ProcessEnv);
    expect(embeddingHash("robot arm", config.modelId, config.dimensions)).toBe(
      embeddingHash("robot arm", same.modelId, same.dimensions)
    );
    expect(
      embeddingHash("robot arm", config.modelId, config.dimensions)
    ).not.toBe(embeddingHash("robot arm", config.modelId, 256));
  });
});
