// Shared, dependency-free definitions for the staff scope assessment (#61).
// Client-safe: the panel reads the labels and the schema, the server reads
// the schema. No AWS, no DB, no node built-ins here.

import { z } from "zod";

/**
 * A closed set, assessed against both one term and three terms regardless of
 * the project's program: "too large for one term, about right for three" is
 * the answer that tells staff to move the project, and one verdict cannot
 * express it.
 */
export const SCOPE_VERDICTS = [
  "under_scoped",
  "about_right",
  "too_large",
] as const;

export type ScopeVerdict = (typeof SCOPE_VERDICTS)[number];

export const SCOPE_VERDICT_LABELS: Record<ScopeVerdict, string> = {
  under_scoped: "Under-scoped",
  about_right: "About right",
  too_large: "Too large",
};

/**
 * Capped in the schema, not merely asked for in the prompt, the way
 * `RATIONALE_MAX_LENGTH` caps the review's rationales. Long enough for two
 * or three sentences naming what drove the verdict.
 */
export const SCOPE_RATIONALE_MAX_LENGTH = 600;

export const scopeAssessmentSchema = z.object({
  oneTerm: z.enum(SCOPE_VERDICTS),
  threeTerms: z.enum(SCOPE_VERDICTS),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(SCOPE_RATIONALE_MAX_LENGTH),
});

export type ScopeAssessment = z.infer<typeof scopeAssessmentSchema>;

/** What the `projects.scope_assessment` column holds. */
export interface StoredScopeAssessment extends ScopeAssessment {
  model: string;
}

/** What the staff panel reads. */
export interface ScopeAssessmentView {
  assessedAt: Date | string;
  assessment: StoredScopeAssessment;
  /**
   * The project's text no longer matches what was assessed. Rendered as
   * "assessed against an earlier version" rather than hidden or silently
   * re-run: re-running spends money on every page view, hiding throws away
   * the thing staff were about to read.
   */
  stale: boolean;
}

/**
 * "High uncertainty" falls out of low confidence rather than being a separate
 * flag, so there is one thing to reason about instead of two that can
 * disagree.
 */
export function confidenceLabel(
  confidence: number
): "low" | "moderate" | "high" {
  if (confidence < 0.5) {
    return "low";
  }
  return confidence < 0.8 ? "moderate" : "high";
}
