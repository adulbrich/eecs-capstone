// Shared, dependency-free definitions for the AI project review feature.
// Safe to import from both client and server (no AWS or DB imports here).

export const IMPROVABLE_FIELDS = [
  "title",
  "description",
  "problemStatement",
  "objectives",
  "minQualifications",
  "prefQualifications",
  "licenseRestrictions",
] as const;

export type ImprovableField = (typeof IMPROVABLE_FIELDS)[number];

/**
 * The form labels, Title Case as docs/UI-CONVENTIONS.md "Form inputs" has it
 * for the project and inventory forms. One source for the form and for the
 * field tags the review prompt hands the model, so the two cannot drift
 * (#375).
 */
export const FIELD_LABELS: Record<ImprovableField, string> = {
  title: "Title",
  description: "Description",
  problemStatement: "Problem Statement",
  objectives: "Objectives",
  minQualifications: "Minimum Qualifications",
  prefQualifications: "Preferred Qualifications",
  licenseRestrictions: "Licensing / IP / NDA Notes",
};

/**
 * The same fields as the project page names them: sentence case, because a
 * page heading is not a form label, and without "Notes" on the agreement
 * section, whose heading covers the flag as well as the prose. A sibling
 * constant rather than a case transform, since "IP" and "NDA" would not
 * survive one; `project-review-fields.test.ts` pins each heading to its
 * label so they stay the same words.
 */
export const FIELD_HEADINGS: Record<ImprovableField, string> = {
  title: "Title",
  description: "Description",
  problemStatement: "Problem statement",
  objectives: "Objectives",
  minQualifications: "Minimum qualifications",
  prefQualifications: "Preferred qualifications",
  licenseRestrictions: "Licensing / IP / NDA",
};

/**
 * Character ceilings for the improvable fields, and the single source for the
 * three places that need them: the form schema that validates on submit, the
 * review server function's input schema, and the tool schema handed to the
 * model. They used to be three independent copies of the same numbers, which is
 * how the model came to be told nothing about a limit its output had to meet.
 */
export const FIELD_MAX_LENGTHS: Record<ImprovableField, number> = {
  title: 200,
  description: 5000,
  problemStatement: 5000,
  objectives: 5000,
  minQualifications: 2000,
  prefQualifications: 2000,
  licenseRestrictions: 1000,
};

export interface FieldSuggestion {
  rationale: string;
  suggestion: string;
}

export interface ReviewResult {
  model: string;
  reviewedFields: ImprovableField[];
  suggestions: Partial<Record<ImprovableField, FieldSuggestion>>;
}
