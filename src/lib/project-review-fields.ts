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

export const FIELD_LABELS: Record<ImprovableField, string> = {
  title: "Title",
  description: "Description",
  problemStatement: "Problem statement",
  objectives: "Objectives / deliverables",
  minQualifications: "Minimum qualifications",
  prefQualifications: "Preferred qualifications",
  licenseRestrictions: "Licensing / IP / NDA notes",
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
