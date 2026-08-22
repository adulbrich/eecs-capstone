import { describe, expect, it, vi } from "vitest";
import type { MantleResponse } from "#/lib/_internal/bedrock-mantle";
import { FIELD_MAX_LENGTHS } from "#/lib/project-review-fields";
import { PROPOSAL_SCOPE_RULE } from "#/lib/proposal-guidance";
import {
  buildUserMessage,
  parseReviewResponse,
  reviewToolSpec,
  runProjectReview,
  SYSTEM_PROMPT,
  TOOL_NAME,
} from "../_internal/project-review-core";

function toolResponse(input: unknown): MantleResponse {
  return {
    status: "completed",
    output: [
      {
        type: "function_call",
        name: TOOL_NAME,
        arguments: JSON.stringify(input),
      },
    ],
  };
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
  it("maps a function call into ReviewResult with only suggested fields", () => {
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

  it("finds a function call nested inside an output item's content", () => {
    const nested: MantleResponse = {
      status: "completed",
      output: [
        {
          type: "message",
          content: [
            {
              type: "function_call",
              name: TOOL_NAME,
              arguments: JSON.stringify({
                title: { suggestion: "Sharper", rationale: "punchier" },
              }),
            },
          ],
        },
      ],
    };
    expect(parseReviewResponse(nested, "m").suggestions.title?.suggestion).toBe(
      "Sharper"
    );
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
    const noTool: MantleResponse = {
      status: "completed",
      output: [{ type: "message", content: [{ type: "output_text" }] }],
    };
    expect(() => parseReviewResponse(noTool, "m")).toThrow();
  });

  it("throws when the arguments are not valid JSON", () => {
    const badJson: MantleResponse = {
      status: "completed",
      output: [{ type: "function_call", name: TOOL_NAME, arguments: "{oops" }],
    };
    expect(() => parseReviewResponse(badJson, "m")).toThrow();
  });

  it("throws when tool input fails schema validation", () => {
    expect(() =>
      parseReviewResponse(
        toolResponse({ description: { suggestion: "missing rationale" } }),
        "m"
      )
    ).toThrow();
  });

  it("drops an over-long suggestion and keeps the rest of the review", () => {
    const result = parseReviewResponse(
      toolResponse({
        title: {
          suggestion: "x".repeat(FIELD_MAX_LENGTHS.title + 1),
          rationale: "too long",
        },
        description: { suggestion: "Fits fine.", rationale: "clearer" },
      }),
      "m"
    );
    // Applying an over-long suggestion would fail validation on submit with an
    // error the user did not cause, so it must not reach the form at all.
    expect(result.suggestions.title).toBeUndefined();
    expect(result.reviewedFields).toEqual(["description"]);
  });

  it("keeps a suggestion that is exactly at the limit", () => {
    const result = parseReviewResponse(
      toolResponse({
        title: {
          suggestion: "x".repeat(FIELD_MAX_LENGTHS.title),
          rationale: "at the edge",
        },
      }),
      "m"
    );
    expect(result.reviewedFields).toEqual(["title"]);
  });

  it("names truncation separately from a missing tool call", () => {
    const truncated: MantleResponse = {
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
      output: [],
    };
    expect(() => parseReviewResponse(truncated, "m")).toThrow(
      /ran out of room/
    );
  });
});

describe("runProjectReview", () => {
  it("invokes the model with the tool declared and returns parsed suggestions", async () => {
    const invoke = vi.fn().mockResolvedValue(
      toolResponse({
        title: { suggestion: "Sharper Title", rationale: "punchier" },
      })
    );
    const result = await runProjectReview({ title: "old title" }, invoke);
    expect(invoke).toHaveBeenCalledTimes(1);
    const call = invoke.mock.calls[0][0];
    expect(call.tools[0].name).toBe(TOOL_NAME);
    expect(call.tools[0].type).toBe("function");
    expect(call.instructions).toBe(SYSTEM_PROMPT);
    expect(call.input[0].content).toContain("old title");
    expect(result.suggestions.title?.suggestion).toBe("Sharper Title");
  });

  it("opts out of the 30 day response retention the API defaults to", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue(
        toolResponse({ title: { suggestion: "s", rationale: "r" } })
      );
    await runProjectReview({ title: "old title" }, invoke);
    expect(invoke.mock.calls[0][0].store).toBe(false);
  });

  it("sends no sampling parameters, which reasoning mode rejects", async () => {
    const invoke = vi
      .fn()
      .mockResolvedValue(
        toolResponse({ title: { suggestion: "s", rationale: "r" } })
      );
    await runProjectReview({ title: "old title" }, invoke);
    const call = invoke.mock.calls[0][0];
    expect(call.temperature).toBeUndefined();
    expect(call.top_p).toBeUndefined();
  });

  it("returns an empty result without calling the model when there is nothing to review", async () => {
    const invoke = vi.fn();
    const result = await runProjectReview({ description: "   " }, invoke);
    expect(invoke).not.toHaveBeenCalled();
    expect(result.reviewedFields).toEqual([]);
    expect(result.suggestions).toEqual({});
  });
});

describe("SYSTEM_PROMPT", () => {
  it("tells the model that field content is markdown", () => {
    expect(SYSTEM_PROMPT).toContain("Markdown");
  });

  it("tells the model to return markdown and preserve structure", () => {
    expect(SYSTEM_PROMPT).toContain("Return each suggestion as Markdown");
  });

  it("states every field's character limit", () => {
    for (const [field, max] of Object.entries(FIELD_MAX_LENGTHS)) {
      expect(SYSTEM_PROMPT).toContain(`${field} (${max})`);
    }
  });

  it("names the reader the proposal is edited for", () => {
    expect(SYSTEM_PROMPT).toContain("undergraduate students");
  });

  it("carries the same scope bar the form states to the proposer", () => {
    expect(SYSTEM_PROMPT).toContain(PROPOSAL_SCOPE_RULE);
  });

  it("rules out cosmetic-only suggestions", () => {
    expect(SYSTEM_PROMPT).toContain("cosmetic change alone");
  });
});

describe("reviewToolSpec", () => {
  it("caps each suggestion at its field's limit", () => {
    const props = reviewToolSpec.parameters.properties as Record<
      string,
      { properties: { suggestion: { maxLength: number } } }
    >;
    for (const [field, max] of Object.entries(FIELD_MAX_LENGTHS)) {
      expect(props[field].properties.suggestion.maxLength).toBe(max);
    }
  });

  it("caps the rationale so it stays on one line", () => {
    const props = reviewToolSpec.parameters.properties as Record<
      string,
      { properties: { rationale: { maxLength: number } } }
    >;
    expect(props.title.properties.rationale.maxLength).toBeLessThanOrEqual(120);
  });
});
