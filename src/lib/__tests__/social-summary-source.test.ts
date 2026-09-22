import { describe, expect, it } from "vitest";
import {
  buildSocialSummarySource,
  SOCIAL_SUMMARY_SOURCE_LIMIT,
  socialSummaryHash,
} from "#/lib/social-summary-source";

const EMOJI = "\u{1F600}";

/** A lone half of a surrogate pair, either half, anywhere in the string. */
const BROKEN_PAIR =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

function project(
  over: Partial<Parameters<typeof buildSocialSummarySource>[0]>
) {
  return {
    title: "Rover",
    description: "A rover that streams sensor data.",
    problemStatement: "Greenhouses are checked by hand.",
    ...over,
  };
}

describe("buildSocialSummarySource", () => {
  it("wraps each field that has text and skips the ones that do not", () => {
    expect(buildSocialSummarySource(project({ problemStatement: null }))).toBe(
      "<Title>\nRover\n</Title>\n\n<Description>\nA rover that streams sensor data.\n</Description>"
    );
  });

  it("returns nothing for a project with none of the three", () => {
    expect(
      buildSocialSummarySource({
        title: "   ",
        description: null,
        problemStatement: "",
      })
    ).toBe("");
  });

  it("stays within the limit and closes the tag it cut", () => {
    // The defect (#566): the old build joined the three fields and sliced the
    // result, so any over-limit source ended inside `</Description`. That
    // string is what `socialSummaryHash` covers, so a request the model
    // rejected was rejected identically on every later sweep.
    const source = buildSocialSummarySource(
      project({ description: "x".repeat(SOCIAL_SUMMARY_SOURCE_LIMIT * 2) })
    );
    expect(source.length).toBeLessThanOrEqual(SOCIAL_SUMMARY_SOURCE_LIMIT);
    expect(source.endsWith("</Description>")).toBe(true);
    expect(
      source.startsWith("<Title>\nRover\n</Title>\n\n<Description>\n")
    ).toBe(true);
  });

  it("cuts a run of emoji on a whole character", () => {
    // 6000 emoji is 12000 code units, exactly the limit, and the old slice
    // landed between the halves of a pair.
    const source = buildSocialSummarySource(
      project({ description: EMOJI.repeat(6000) })
    );
    expect(source.length).toBeLessThanOrEqual(SOCIAL_SUMMARY_SOURCE_LIMIT);
    expect(source.endsWith("</Description>")).toBe(true);
    expect(BROKEN_PAIR.test(source)).toBe(false);
  });

  it("drops a field that cannot fit rather than writing an empty tag", () => {
    // An empty `<Problem statement></Problem statement>` tells the model
    // nothing and spends tokens saying it.
    const source = buildSocialSummarySource(
      project({ description: "x".repeat(SOCIAL_SUMMARY_SOURCE_LIMIT) })
    );
    expect(source).not.toContain("<Problem statement>");
  });

  it("leaves a source under the limit exactly as it was", () => {
    const small = project({});
    expect(buildSocialSummarySource(small)).toBe(
      "<Title>\nRover\n</Title>\n\n<Description>\nA rover that streams sensor data.\n</Description>\n\n<Problem statement>\nGreenhouses are checked by hand.\n</Problem statement>"
    );
  });

  it("trims each field before wrapping it", () => {
    expect(
      buildSocialSummarySource({
        title: "  Rover  ",
        description: null,
        problemStatement: null,
      })
    ).toBe("<Title>\nRover\n</Title>");
  });
});

describe("socialSummaryHash", () => {
  it("changes with the model id, so switching models regenerates", () => {
    const source = buildSocialSummarySource(project({}));
    expect(socialSummaryHash(source, "model-a")).not.toBe(
      socialSummaryHash(source, "model-b")
    );
  });

  it("is stable for the same source and model", () => {
    const source = buildSocialSummarySource(project({}));
    expect(socialSummaryHash(source, "m")).toBe(socialSummaryHash(source, "m"));
  });
});
