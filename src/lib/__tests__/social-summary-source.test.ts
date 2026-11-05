import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import {
  buildSocialSummarySource,
  SOCIAL_SUMMARY_SOURCE_LIMIT,
  socialSummaryHash,
} from "#/lib/social-summary-source";
import {
  isWellFormed,
  trickyText,
  trickyTextAcross,
} from "#/test/shared/arbitraries";

const EMOJI = "\u{1F600}";

/** A lone half of a surrogate pair, either half, anywhere in the string. */
const BROKEN_PAIR =
  /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;

/** A field written with nothing between its tags. */
const EMPTY_TAG = /<([^>/]+)>\n\n<\/\1>/u;

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

  it("drops a field whose one unit of room is half an emoji", () => {
    // The defect (#831): a title of 11,951 leaves the description a room of
    // one, the slice keeps only the high surrogate, the strip empties it, and
    // the old check had already passed, so `<Description>\n\n</Description>`
    // went into the prompt and the hash.
    const title = "x".repeat(11_951);
    const source = buildSocialSummarySource(
      project({ title, description: `${EMOJI} rover` })
    );
    expect(source).not.toContain("<Description>");
    expect(source).toBe(`<Title>\n${title}\n</Title>`);

    expect(
      buildSocialSummarySource(project({ title, description: "A rover" }))
    ).toBe(`<Title>\n${title}\n</Title>\n\n<Description>\nA\n</Description>`);
  });

  it("cuts a title of emoji on a whole character rather than dropping it", () => {
    // The title is first, so its room is always the limit less its own 17
    // and never one: an odd cut there loses half a pair, not the field.
    const source = buildSocialSummarySource(
      project({ title: EMOJI.repeat(SOCIAL_SUMMARY_SOURCE_LIMIT) })
    );
    expect(source.length).toBeLessThanOrEqual(SOCIAL_SUMMARY_SOURCE_LIMIT);
    expect(source.startsWith(`<Title>\n${EMOJI}`)).toBe(true);
    expect(source.endsWith("</Title>")).toBe(true);
    expect(source).not.toMatch(EMPTY_TAG);
    expect(BROKEN_PAIR.test(source)).toBe(false);
  });

  it.each([
    // 12,000 less the title's 17 and the description's 2 + 29 leaves 1.
    {
      field: "description",
      fields: { title: "x".repeat(11_951), description: EMOJI },
    },
    // 12,000 less the title's 17 and the problem statement's 2 + 41 leaves 1.
    {
      field: "problem statement",
      fields: {
        title: "x".repeat(11_939),
        description: null,
        problemStatement: EMOJI,
      },
    },
  ])(
    "never writes an empty $field tag when its one unit of room is half an emoji",
    ({ fields }) => {
      const source = buildSocialSummarySource(project(fields));
      expect(source.length).toBeLessThanOrEqual(SOCIAL_SUMMARY_SOURCE_LIMIT);
      expect(source).not.toMatch(EMPTY_TAG);
      expect(BROKEN_PAIR.test(source)).toBe(false);
    }
  );

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

/**
 * A title of filler sized to leave the description `room` code units: the
 * builder charges the title's value and its two tags first, then the
 * separator and the description's two tags. The arithmetic is the builder's
 * own, from its comment on the seven.
 */
function titleLeaving(room: number): string {
  const titleCost = "Title".length * 2 + 7;
  const descriptionCost = 2 + "Description".length * 2 + 7;
  return "a".repeat(
    SOCIAL_SUMMARY_SOURCE_LIMIT - titleCost - descriptionCost - room
  );
}

/**
 * Short fields, a title that leaves the description a few units of room, or a
 * title cut itself. The constant 1 is weighted in because one unit of room
 * with an emoji first is the only way to reach the empty-body check (#831),
 * and random sizes would almost never land on it.
 */
const summaryProject = fc.record({
  title: fc.oneof(
    trickyText(),
    fc
      .oneof(fc.constant(1), fc.integer({ max: 40, min: -2 }))
      .map(titleLeaving),
    trickyTextAcross(SOCIAL_SUMMARY_SOURCE_LIMIT - "Title".length * 2 - 7)
  ),
  description: fc.option(trickyText({ size: "medium" })),
  problemStatement: fc.option(trickyText({ size: "medium" })),
});

describe("buildSocialSummarySource, on generated projects", () => {
  test.prop([summaryProject])(
    "stays within the limit, well-formed, with no empty tag",
    (generated) => {
      const source = buildSocialSummarySource(generated);
      expect(source.length).toBeLessThanOrEqual(SOCIAL_SUMMARY_SOURCE_LIMIT);
      expect(isWellFormed(source)).toBe(true);
      expect(source).not.toMatch(EMPTY_TAG);
    }
  );
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
