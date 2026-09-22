import { describe, expect, it } from "vitest";
import type {
  MantleResponse,
  ResponsesFn,
} from "#/lib/_internal/bedrock-mantle";
import { SOCIAL_SUMMARY_MAX_LENGTH } from "#/lib/social-summary";
import {
  parseSocialSummaryResponse,
  runSocialSummary,
  SOCIAL_SUMMARY_TOOL_NAME,
  socialSummaryToolSpec,
} from "../_internal/social-summary-core";

const EMOJI = "\u{1F600}";

function toolResponse(input: unknown): MantleResponse {
  return {
    status: "completed",
    output: [
      {
        type: "function_call",
        name: SOCIAL_SUMMARY_TOOL_NAME,
        arguments: JSON.stringify(input),
      },
    ],
  };
}

const answering =
  (response: MantleResponse): ResponsesFn =>
  () =>
    Promise.resolve(response);

describe("parseSocialSummaryResponse", () => {
  it("returns the summary with its surrounding space gone", () => {
    expect(
      parseSocialSummaryResponse(toolResponse({ summary: "  A rover.  " }))
    ).toBe("A rover.");
  });

  it("refuses a summary of nothing but whitespace", () => {
    // The blank result (#565): `.min(1)` on the untrimmed value accepted three
    // spaces, the trim happened afterwards, and an empty string came back as a
    // successful generation.
    expect(() =>
      parseSocialSummaryResponse(toolResponse({ summary: "   " }))
    ).toThrow();
  });

  it("accepts 151 emoji, which the panel and the server also accept", () => {
    const summary = EMOJI.repeat(151);
    expect(summary.length).toBeGreaterThan(SOCIAL_SUMMARY_MAX_LENGTH);
    expect(parseSocialSummaryResponse(toolResponse({ summary }))).toBe(summary);
  });

  it("refuses a summary over the cap rather than clipping it", () => {
    expect(() =>
      parseSocialSummaryResponse(
        toolResponse({ summary: "x".repeat(SOCIAL_SUMMARY_MAX_LENGTH + 1) })
      )
    ).toThrow();
  });

  it("refuses a response that ran out of room", () => {
    expect(() =>
      parseSocialSummaryResponse({ status: "incomplete", output: [] })
    ).toThrow(/ran out of room/);
  });

  it("refuses a response with no tool call in it", () => {
    expect(() =>
      parseSocialSummaryResponse({ status: "completed", output: [] })
    ).toThrow();
  });
});

describe("runSocialSummary", () => {
  it("reports a well-formed answer as ok", async () => {
    const run = await runSocialSummary(
      "<Title>\nRover\n</Title>",
      answering(toolResponse({ summary: "A rover." }))
    );
    expect(run.outcome).toBe("ok");
    expect(run.result).toBe("A rover.");
  });

  it("reports a blank answer as failed, not as ok with an empty string", async () => {
    // What made this worth a test: `regenerateSocialSummaryAs` writes the
    // usage row from `run.outcome`, so a blank answer reported as ok billed
    // the call as a success while staff were shown a failure.
    const run = await runSocialSummary(
      "<Title>\nRover\n</Title>",
      answering(toolResponse({ summary: "   " }))
    );
    expect(run.outcome).toBe("failed");
    expect(run.result).toBeNull();
  });

  it("reports a truncated response as truncated", async () => {
    const run = await runSocialSummary(
      "<Title>\nRover\n</Title>",
      answering({ status: "incomplete", output: [] })
    );
    expect(run.outcome).toBe("truncated");
    expect(run.result).toBeNull();
  });

  it("reports a transport failure as failed and does not throw", async () => {
    const run = await runSocialSummary("<Title>\nRover\n</Title>", () =>
      Promise.reject(new Error("Bedrock is down"))
    );
    expect(run.outcome).toBe("failed");
    expect(run.error).toContain("Bedrock is down");
  });

  it("sends the tool spec and the source, and stores nothing", async () => {
    let body: Record<string, unknown> | undefined;
    const invoke: ResponsesFn = (sent) => {
      body = sent;
      return Promise.resolve(toolResponse({ summary: "A rover." }));
    };
    await runSocialSummary("<Title>\nRover\n</Title>", invoke);
    expect(body?.tools).toEqual([socialSummaryToolSpec]);
    // Proposals carry unpublished IP, so nothing is retained on the endpoint.
    expect(body?.store).toBe(false);
    expect(body?.input).toEqual([
      { role: "user", content: "<Title>\nRover\n</Title>" },
    ]);
  });
});

describe("socialSummaryToolSpec", () => {
  it("caps the summary at the same number the schema does", () => {
    // JSON Schema `maxLength` counts code points, which is the rule the app
    // counts with (#565). The two halves agreeing is what stops the model
    // producing summaries the schema then throws away.
    expect(socialSummaryToolSpec.parameters.properties.summary.maxLength).toBe(
      SOCIAL_SUMMARY_MAX_LENGTH
    );
  });
});
