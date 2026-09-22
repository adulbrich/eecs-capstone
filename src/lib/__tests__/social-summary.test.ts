import { describe, expect, it } from "vitest";
import {
  SOCIAL_SUMMARY_EMPTY_MESSAGE,
  SOCIAL_SUMMARY_MAX_LENGTH,
  SOCIAL_SUMMARY_TOO_LONG_MESSAGE,
  socialSummaryLength,
  socialSummarySchema,
  socialSummaryTextSchema,
} from "#/lib/social-summary";

/** 151 of these are 302 UTF-16 code units and 151 code points. */
const EMOJI = "\u{1F600}";

/**
 * The cap used to be counted three ways and the three disagreed (#565): the
 * Zod schema and the tool spec's JSON Schema counted code points, while the
 * server cap and the panel counter read `String.prototype.length`, which
 * counts UTF-16 code units. A summary of 151 emoji sat between them, accepted
 * by one half and rejected by the other with no message that explained it.
 *
 * These pin the one rule. The panel counter is held to it by
 * `social-preview-section.test.tsx`, which is the third site and the only one
 * that needs a DOM.
 */
describe("socialSummaryLength", () => {
  it("counts an emoji as one, not two", () => {
    expect(socialSummaryLength(EMOJI)).toBe(1);
    expect(EMOJI.length).toBe(2);
  });

  it("counts plain text the same way length does", () => {
    expect(socialSummaryLength("A rover.")).toBe(8);
  });
});

describe("socialSummaryTextSchema", () => {
  it("accepts 151 emoji, which is 302 code units and under the cap", () => {
    const summary = EMOJI.repeat(151);
    expect(summary.length).toBeGreaterThan(SOCIAL_SUMMARY_MAX_LENGTH);
    expect(socialSummaryLength(summary)).toBeLessThanOrEqual(
      SOCIAL_SUMMARY_MAX_LENGTH
    );
    expect(socialSummaryTextSchema.safeParse(summary).success).toBe(true);
  });

  it("rejects the same text one code point over the cap", () => {
    const summary = EMOJI.repeat(SOCIAL_SUMMARY_MAX_LENGTH + 1);
    const result = socialSummaryTextSchema.safeParse(summary);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(
      SOCIAL_SUMMARY_TOO_LONG_MESSAGE
    );
  });

  it("accepts text at exactly the cap and rejects it one past", () => {
    expect(
      socialSummaryTextSchema.safeParse("x".repeat(SOCIAL_SUMMARY_MAX_LENGTH))
        .success
    ).toBe(true);
    expect(
      socialSummaryTextSchema.safeParse(
        "x".repeat(SOCIAL_SUMMARY_MAX_LENGTH + 1)
      ).success
    ).toBe(false);
  });

  it("trims before it judges, so surrounding space is not stored", () => {
    expect(socialSummaryTextSchema.parse("  A rover.  ")).toBe("A rover.");
  });

  it("refuses whitespace only, which min(1) alone accepted", () => {
    // The blank model result (#565): `{"summary":"   "}` passed `.min(1)` on
    // the untrimmed value, was trimmed to nothing afterwards, and was reported
    // as a successful generation of an empty string.
    const result = socialSummaryTextSchema.safeParse("   ");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(SOCIAL_SUMMARY_EMPTY_MESSAGE);
  });

  it("measures the cap after the trim, not before", () => {
    const padded = `  ${"x".repeat(SOCIAL_SUMMARY_MAX_LENGTH)}  `;
    expect(padded.length).toBeGreaterThan(SOCIAL_SUMMARY_MAX_LENGTH);
    expect(socialSummaryTextSchema.safeParse(padded).success).toBe(true);
  });
});

describe("socialSummarySchema", () => {
  it("is the field schema under a summary key", () => {
    expect(socialSummarySchema.parse({ summary: " A rover. " })).toEqual({
      summary: "A rover.",
    });
  });

  it("rejects a blank summary, so a blank model result cannot parse", () => {
    expect(socialSummarySchema.safeParse({ summary: " \n\t " }).success).toBe(
      false
    );
  });
});
