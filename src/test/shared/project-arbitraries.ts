import { fc } from "@fast-check/vitest";
import { EMBEDDING_SOURCE_LIMIT } from "#/lib/embedding-source";
import {
  buildSocialSummarySource,
  SOCIAL_SUMMARY_SOURCE_LIMIT,
} from "#/lib/social-summary-source";
import { trickyText, trickyTextAcross } from "./arbitraries";

/**
 * Generated projects for the two hashed source builders. Shared by each
 * builder's own properties and by the parity test that runs its copy in
 * `scripts/`, so both are checked on the same inputs and the generator that
 * reaches the cut exists once.
 */

/**
 * What the builder spends around its values, measured from its own output
 * rather than restated, so a change to the tags moves these with it and the
 * generator below keeps reaching the cut.
 */
const TITLE_TAGS =
  buildSocialSummarySource({
    description: null,
    problemStatement: null,
    title: "a",
  }).length - 1;
const TITLE_AND_DESCRIPTION_TAGS =
  buildSocialSummarySource({
    description: "a",
    problemStatement: null,
    title: "a",
  }).length - 2;

/** A title of filler sized to leave the description `room` code units. */
function titleLeaving(room: number): string {
  return "a".repeat(
    SOCIAL_SUMMARY_SOURCE_LIMIT - TITLE_AND_DESCRIPTION_TAGS - room
  );
}

/**
 * Short fields, a title that leaves the description a few units of room, or a
 * title cut itself. The constant 1 is weighted in because one unit of room
 * with an emoji first is the only way to reach the empty-body check (#831),
 * and random sizes would almost never land on it.
 */
export const summaryProject = fc.record({
  title: fc.oneof(
    trickyText(),
    fc
      .oneof(fc.constant(1), fc.integer({ max: 40, min: -2 }))
      .map(titleLeaving),
    trickyTextAcross(SOCIAL_SUMMARY_SOURCE_LIMIT - TITLE_TAGS)
  ),
  description: fc.option(trickyText({ size: "medium" })),
  problemStatement: fc.option(trickyText({ size: "medium" })),
});

/**
 * Short fields, or a title long enough that the cut at the limit lands in
 * tricky text: the title is the first section, so its filler is the only
 * thing in front of the cut besides its own label.
 */
export const embeddableProject = fc.record({
  title: fc.oneof(
    trickyText(),
    trickyTextAcross(EMBEDDING_SOURCE_LIMIT - "Title: ".length)
  ),
  description: fc.option(trickyText()),
  problemStatement: fc.option(trickyText()),
  objectives: fc.option(trickyText()),
  minQualifications: fc.option(trickyText()),
  prefQualifications: fc.option(trickyText()),
  licenseRestrictions: fc.option(trickyText()),
});
