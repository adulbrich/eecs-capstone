// Shared, dependency-free definitions for the social summary (#498).
// Client-safe: the staff panel reads the cap, the server reads the schema.
// No AWS, no DB, no node built-ins here.

import { z } from "zod";

/**
 * Capped in the schema rather than only asked for in the prompt, the way
 * `SCOPE_RATIONALE_MAX_LENGTH` caps the scope rationale.
 *
 * Deliberately larger than `SOCIAL_DESCRIPTION_MAX_LENGTH` in
 * `social-meta.ts`, which is the 160 characters a preview card shows. A model
 * that lands slightly long should produce a summary that gets truncated on a
 * word boundary at render time, not a failed generation and a null column. The
 * same cap bounds what staff may type in the panel, so a hand-written summary
 * and a generated one are held to one rule.
 */
export const SOCIAL_SUMMARY_MAX_LENGTH = 300;

/**
 * The one counting rule the cap is measured with, spelled once because it was
 * spelled three ways and they disagreed (#565).
 *
 * Code points, not the UTF-16 code units `String.prototype.length` returns.
 * Anything outside the basic plane is two code units, so 151 emoji measure 302
 * by `.length` and 151 here. Zod 4 counts code points, and JSON Schema's
 * `maxLength` in the tool spec is defined on them too, so the two halves this
 * project does not control were already counting this way; it was the server
 * cap and the panel counter reading `.length` that made a summary the schema
 * accepted impossible to save and impossible to explain.
 *
 * Code points rather than grapheme clusters, which is the other honest answer
 * and needs `Intl.Segmenter`. A family emoji is seven code points and one
 * grapheme, so this over-counts it; the cap exists to bound a preview card,
 * not to be a typographic measure, and the three places that have to agree are
 * a Zod schema, a JSON Schema and a React counter. Code points is the only rule
 * all three can express.
 */
export function socialSummaryLength(text: string): number {
  return [...text].length;
}

export const SOCIAL_SUMMARY_EMPTY_MESSAGE =
  "A summary cannot be empty. Use Regenerate with AI.";

export const SOCIAL_SUMMARY_TOO_LONG_MESSAGE = `A summary is at most ${SOCIAL_SUMMARY_MAX_LENGTH} characters.`;

/**
 * One summary's text, trimmed before it is judged.
 *
 * The trim is inside the schema rather than at each call site, because both
 * defects it prevents came from trimming afterwards. A model returning
 * `{"summary":"   "}` passed `.min(1)` on three spaces and reached the caller
 * as an empty string with `outcome: "ok"`, so a useless call was metered as a
 * success. And a staff save that trimmed after validating would let the cap be
 * measured against text nobody stores.
 *
 * `.refine` rather than `.max`, although Zod 4's `.max` happens to count the
 * same way: the rule is this project's and belongs in one function the panel
 * can call too, not in a validator's implementation detail that a major bump
 * is free to change. It changed once already, which is how the cap came to be
 * counted three ways.
 */
export const socialSummaryTextSchema = z
  .string()
  .transform((text) => text.trim())
  .pipe(
    z
      .string()
      .min(1, SOCIAL_SUMMARY_EMPTY_MESSAGE)
      .refine(
        (text) => socialSummaryLength(text) <= SOCIAL_SUMMARY_MAX_LENGTH,
        SOCIAL_SUMMARY_TOO_LONG_MESSAGE
      )
  );

export const socialSummarySchema = z.object({
  summary: socialSummaryTextSchema,
});

export type SocialSummaryResult = z.infer<typeof socialSummarySchema>;

/**
 * What the staff panel renders: the stored text, when it was written, and
 * whether a human wrote it. `stale` is deliberately absent, unlike
 * `ScopeAssessmentView`: a stale summary regenerates by itself on the next
 * edit or transition, so there is nothing for staff to act on.
 */
export interface SocialSummaryView {
  isManual: boolean;
  summary: string | null;
  updatedAt: Date | null;
}

/**
 * What Regenerate did, beside what it leaves stored.
 *
 * `changed` is the lost race: the row moved between the read that fed the
 * model and the write that would have stored its answer, so the write matched
 * nothing and the model's text was discarded (#564). The view returned beside
 * it is the row re-read, so the panel shows what is stored rather than what
 * was asked for.
 *
 * Named for what happened to the row rather than for who did it. A staff save
 * is the case that motivated the guard, but `refreshSocialSummary` running on
 * an edit that published mid-rewrite trips exactly the same compare-and-swap,
 * and telling staff a colleague overwrote them would be wrong half the time.
 */
export type RegenerateSocialSummaryOutcome = "rewritten" | "changed";

export interface RegenerateSocialSummaryResult extends SocialSummaryView {
  outcome: RegenerateSocialSummaryOutcome;
}
