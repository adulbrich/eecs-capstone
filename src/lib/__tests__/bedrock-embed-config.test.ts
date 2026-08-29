import { describe, expect, it } from "vitest";
import { buildEmbedConfig } from "#/lib/_internal/bedrock-embed";
import { embeddingHash } from "#/lib/embedding-source";

describe("buildEmbedConfig", () => {
  it("defaults to Titan v2 at 1024 dimensions", () => {
    expect(buildEmbedConfig({} as NodeJS.ProcessEnv)).toEqual({
      dimensions: 1024,
      modelId: "amazon.titan-embed-text-v2:0",
    });
  });

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
