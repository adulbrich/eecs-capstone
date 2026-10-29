import { describe, expect, it } from "vitest";
import { parseSaveSocialSummaryInput } from "#/server/social-summary";

describe("a social summary save from a tab loaded before #583", () => {
  // It sends no `expected`, so it cannot say what it is replacing; it is
  // refused rather than saved unguarded over a colleague.
  const PROJECT = "11111111-1111-4111-8111-111111111111";

  it("is refused with a sentence, not a ZodError", () => {
    expect(() =>
      parseSaveSocialSummaryInput({ projectId: PROJECT, summary: "Wording." })
    ).toThrow(
      "This page is out of date. Reload it and save the summary again."
    );
  });

  it("still parses a current tab's save", () => {
    expect(
      parseSaveSocialSummaryInput({
        projectId: PROJECT,
        summary: "  Wording.  ",
        expected: { summary: null, isManual: false },
      })
    ).toEqual({
      projectId: PROJECT,
      summary: "Wording.",
      expected: { summary: null, isManual: false },
    });
  });
});
