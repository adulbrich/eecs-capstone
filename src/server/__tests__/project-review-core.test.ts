import type { ConverseCommandOutput } from "@aws-sdk/client-bedrock-runtime";
import { describe, expect, it, vi } from "vitest";
import {
  buildUserMessage,
  parseReviewResponse,
  runProjectReview,
  TOOL_NAME,
} from "../_internal/project-review-core";

function toolResponse(input: unknown): ConverseCommandOutput {
  return {
    output: {
      message: {
        role: "assistant",
        content: [{ toolUse: { name: TOOL_NAME, toolUseId: "t1", input } }],
      },
    },
    stopReason: "tool_use",
  } as unknown as ConverseCommandOutput;
}

describe("buildUserMessage", () => {
  it("includes only non-empty fields, wrapped in delimited tags", () => {
    const msg = buildUserMessage({
      title: "My Project",
      description: "  ",
      objectives: "Build a thing",
    });
    expect(msg).toContain('<field name="title"');
    expect(msg).toContain("My Project");
    expect(msg).toContain('<field name="objectives"');
    expect(msg).not.toContain('name="description"');
    expect(msg).not.toContain('name="problemStatement"');
  });

  it("returns an empty string when all fields are empty or whitespace", () => {
    expect(buildUserMessage({})).toBe("");
    expect(buildUserMessage({ description: "   ", title: "" })).toBe("");
  });
});

describe("parseReviewResponse", () => {
  it("maps a tool_use response into ReviewResult with only suggested fields", () => {
    const result = parseReviewResponse(
      toolResponse({
        description: { suggestion: "Better desc.", rationale: "clearer" },
        objectives: { suggestion: "Better obj.", rationale: "specific" },
      }),
      "test-model"
    );
    expect(result.model).toBe("test-model");
    expect(result.reviewedFields.sort()).toEqual(["description", "objectives"]);
    expect(result.suggestions.description).toEqual({
      suggestion: "Better desc.",
      rationale: "clearer",
    });
    expect(result.suggestions.title).toBeUndefined();
  });

  it("drops unknown keys the model might emit", () => {
    const result = parseReviewResponse(
      toolResponse({
        contactEmail: { suggestion: "x@y.com", rationale: "no" },
        description: { suggestion: "ok", rationale: "ok" },
      }),
      "m"
    );
    expect(result.reviewedFields).toEqual(["description"]);
    expect(
      (result.suggestions as Record<string, unknown>).contactEmail
    ).toBeUndefined();
  });

  it("throws when the model returns no tool call", () => {
    const noTool = {
      output: { message: { role: "assistant", content: [{ text: "hi" }] } },
      stopReason: "end_turn",
    } as unknown as ConverseCommandOutput;
    expect(() => parseReviewResponse(noTool, "m")).toThrow();
  });

  it("throws when tool input fails schema validation", () => {
    expect(() =>
      parseReviewResponse(
        toolResponse({ description: { suggestion: "missing rationale" } }),
        "m"
      )
    ).toThrow();
  });
});

describe("runProjectReview", () => {
  it("invokes the model with the tool config and returns parsed suggestions", async () => {
    const invoke = vi.fn().mockResolvedValue(
      toolResponse({
        title: { suggestion: "Sharper Title", rationale: "punchier" },
      })
    );
    const result = await runProjectReview({ title: "old title" }, invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
    const call = invoke.mock.calls[0][0];
    expect(call.toolConfig.tools[0].toolSpec.name).toBe(TOOL_NAME);
    expect(call.messages[0].content[0].text).toContain("old title");
    expect(result.suggestions.title?.suggestion).toBe("Sharper Title");
  });

  it("returns an empty result without calling the model when there is nothing to review", async () => {
    const invoke = vi.fn();
    const result = await runProjectReview({ description: "   " }, invoke);
    expect(invoke).not.toHaveBeenCalled();
    expect(result.reviewedFields).toEqual([]);
    expect(result.suggestions).toEqual({});
  });
});
