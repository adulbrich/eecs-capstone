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
  licenseRestrictions: "License / IP restrictions",
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
