import { describe, expect, it } from "vitest";
import { buildReviewConfig } from "../project-review-core";

describe("buildReviewConfig", () => {
  it("defaults to the Mantle GPT-5.6 id at medium reasoning", () => {
    expect(buildReviewConfig({} as NodeJS.ProcessEnv)).toEqual({
      modelId: "openai.gpt-5.6-luna",
      reasoningEffort: "medium",
    });
  });

  it("takes both from the environment when they are set", () => {
    expect(
      buildReviewConfig({
        BEDROCK_MODEL_ID: "openai.gpt-5.6-mini",
        BEDROCK_REASONING_EFFORT: "none",
      } as NodeJS.ProcessEnv)
    ).toEqual({ modelId: "openai.gpt-5.6-mini", reasoningEffort: "none" });
  });

  it("does not validate the reasoning effort, which is the operator's to get right", () => {
    // Deliberately pinned. The Responses API rejects an unknown effort itself,
    // and a local allowlist would be a second list to keep in step with the
    // model provider's. .env.example names the accepted values.
    expect(
      buildReviewConfig({
        BEDROCK_REASONING_EFFORT: "extremely-hard",
      } as NodeJS.ProcessEnv).reasoningEffort
    ).toBe("extremely-hard");
  });
});
