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

export const socialSummarySchema = z.object({
  summary: z.string().min(1).max(SOCIAL_SUMMARY_MAX_LENGTH),
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
