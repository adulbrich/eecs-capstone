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
    // Compares the request against the constant that built it, so it pins the
    // wiring and not the number. `buildEmbedConfig` below pins the number.
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

describe("the exported constants", () => {
  it("match what the builder resolves from the same environment", () => {
    // Asserts the wiring, not the values. It used to assert the literals
    // against these constants, which resolve from the ambient environment, so
    // it reddened for any developer who had set either variable to a
    // non-default value. The values themselves are pinned deterministically by
    // the buildEmbedConfig cases below.
    //
    // What this catches, confirmed by mutation: wiring a constant to the wrong
    // field, and hardcoding a wrong literal. What it does not catch is
    // hardcoding the correct default, which is indistinguishable from the
    // resolved value on a machine with neither variable set. Reaching that
    // last case is possible, with vi.stubEnv plus vi.resetModules and a
    // dynamic import, and is not done here: it buys one low-value mutation in
    // exchange for a re-import dance in a file that otherwise has none.
    const config = buildEmbedConfig(process.env);
    expect(EMBEDDING_MODEL_ID).toBe(config.modelId);
    expect(EMBEDDING_DIMENSIONS).toBe(config.dimensions);
  });
});

describe("buildEmbedConfig", () => {
  it("resolves the documented defaults from an empty environment", () => {
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
