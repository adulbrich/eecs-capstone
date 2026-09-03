import { describe, expect, it, vi } from "vitest";
import type {
  MantleResponse,
  ResponsesFn,
} from "#/lib/_internal/bedrock-mantle";
import { PROPOSAL_SCOPE_RULE } from "#/lib/proposal-guidance";
import { SCOPE_RATIONALE_MAX_LENGTH } from "#/lib/scope-assessment";
import {
  buildScopeConfig,
  parseScopeResponse,
  runScopeAssessment,
  SCOPE_MAX_OUTPUT_TOKENS,
  SCOPE_SYSTEM_PROMPT,
  SCOPE_TOOL_NAME,
  scopeToolSpec,
} from "../_internal/scope-assessment-core";

const verdict = {
  oneTerm: "too_large",
  threeTerms: "about_right",
  confidence: 0.65,
  rationale: "Two services and a mobile client exceed one term.",
};

function toolResponse(input: unknown): MantleResponse {
  return {
    status: "completed",
    output: [
      {
        type: "function_call",
        name: SCOPE_TOOL_NAME,
        arguments: JSON.stringify(input),
      },
    ],
  };
}

describe("buildScopeConfig", () => {
  it("shares the model with the review and takes its own, higher effort", () => {
    const config = buildScopeConfig({
      BEDROCK_MODEL_ID: "m",
    } as NodeJS.ProcessEnv);
    expect(config.modelId).toBe("m");
    expect(config.reasoningEffort).toBe("high");
    expect(
      buildScopeConfig({
        BEDROCK_SCOPE_REASONING_EFFORT: "medium",
      } as NodeJS.ProcessEnv).reasoningEffort
    ).toBe("medium");
    // Think hard, answer briefly: the opposite shape from the review's 16384.
    expect(SCOPE_MAX_OUTPUT_TOKENS).toBeLessThan(16_384);
  });
});

describe("the tool schema", () => {
  it("constrains the verdicts to the closed set and caps the rationale", () => {
    const props = scopeToolSpec.parameters.properties;
    expect(props.oneTerm.enum).toEqual([
      "under_scoped",
      "about_right",
      "too_large",
    ]);
    expect(props.threeTerms.enum).toEqual(props.oneTerm.enum);
    expect(props.rationale.maxLength).toBe(SCOPE_RATIONALE_MAX_LENGTH);
    expect(scopeToolSpec.parameters.required).toEqual([
      "oneTerm",
      "threeTerms",
      "confidence",
      "rationale",
    ]);
  });

  it("embeds the one scope rule verbatim", () => {
    expect(SCOPE_SYSTEM_PROMPT).toContain(PROPOSAL_SCOPE_RULE);
  });
});

describe("parseScopeResponse", () => {
  it("maps the tool call onto a stored assessment carrying the model", () => {
    expect(parseScopeResponse(toolResponse(verdict), "test-model")).toEqual({
      ...verdict,
      model: "test-model",
    });
  });

  it("rejects a verdict outside the enum", () => {
    expect(() =>
      parseScopeResponse(toolResponse({ ...verdict, oneTerm: "fine" }), "m")
    ).toThrow(/Couldn't assess/);
  });

  it("rejects a rationale over the cap rather than truncating it", () => {
    const long = "x".repeat(SCOPE_RATIONALE_MAX_LENGTH + 1);
    expect(() =>
      parseScopeResponse(toolResponse({ ...verdict, rationale: long }), "m")
    ).toThrow(/Couldn't assess/);
  });

  it("names a truncated response separately, since the fix differs", () => {
    expect(() =>
      parseScopeResponse({ status: "incomplete", output: [] }, "m")
    ).toThrow(/ran out of room/);
  });
});

describe("runScopeAssessment", () => {
  it("returns the assessment and the usage on success", async () => {
    const invoke = vi.fn<ResponsesFn>(async () => ({
      ...toolResponse(verdict),
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        output_tokens_details: { reasoning_tokens: 15 },
      },
    }));
    const run = await runScopeAssessment("<field>x</field>", invoke);
    expect(run.called).toBe(true);
    expect(run.outcome).toBe("ok");
    expect(run.result?.oneTerm).toBe("too_large");
    expect(run.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      reasoningTokens: 15,
    });
    const body = invoke.mock.calls[0]?.[0] ?? {};
    expect(body.store).toBe(false);
    expect(body.reasoning).toEqual({ effort: "high" });
    expect(body.max_output_tokens).toBe(SCOPE_MAX_OUTPUT_TOKENS);
  });

  it("reports a failed call as called, so it is metered", async () => {
    const invoke = vi.fn<ResponsesFn>(async () => {
      throw new Error("boom");
    });
    const run = await runScopeAssessment("x", invoke);
    expect(run).toMatchObject({
      called: true,
      outcome: "failed",
      result: null,
    });
    expect(run.error).toBe("boom");
  });

  it("reports a truncated response as truncated", async () => {
    const invoke = vi.fn<ResponsesFn>(async () => ({
      status: "incomplete",
      output: [],
    }));
    const run = await runScopeAssessment("x", invoke);
    expect(run.outcome).toBe("truncated");
    expect(run.error).toMatch(/ran out of room/);
  });
});
