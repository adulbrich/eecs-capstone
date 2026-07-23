import { createHash } from "node:crypto";

/**
 * Pure source-text and hash helpers for embeddings. No DB and no AWS imports,
 * so this is trivially unit-testable and safe to import from either side.
 */
export const EMBEDDING_SOURCE_LIMIT = 45_000;

export interface EmbeddableProject {
  description: string | null;
  licenseRestrictions: string | null;
  minQualifications: string | null;
  objectives: string | null;
  prefQualifications: string | null;
  problemStatement: string | null;
  title: string;
}

function section(label: string, value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? `${label}: ${trimmed}` : null;
}

export function buildProjectEmbeddingSource(
  project: EmbeddableProject,
  categoryNames: string[],
  programLabel: string | null
): string {
  const parts = [
    section("Title", project.title),
    section("Description", project.description),
    section("Problem", project.problemStatement),
    section("Objectives", project.objectives),
    section("Minimum qualifications", project.minQualifications),
    section("Preferred qualifications", project.prefQualifications),
    section("License", project.licenseRestrictions),
    section("Program", programLabel),
    section(
      "Categories",
      categoryNames.length > 0 ? categoryNames.join(", ") : null
    ),
  ].filter((part): part is string => part !== null);
  return parts.join("\n\n").slice(0, EMBEDDING_SOURCE_LIMIT);
}

export function buildInterestsEmbeddingSource(interestsText: string): string {
  return interestsText.trim().slice(0, EMBEDDING_SOURCE_LIMIT);
}

export function embeddingHash(
  source: string,
  modelId: string,
  dimensions: number
): string {
  return createHash("sha256")
    .update(`${modelId}:${dimensions}:${source}`)
    .digest("hex");
}
