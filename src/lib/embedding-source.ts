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

/**
 * The "Program" section's text. Here rather than inline at the two call sites
 * because it is part of the embedded source, so it has to be pinned like the
 * rest of it: change the space to a colon and every hash the script wrote
 * stops matching, with nothing to say so. Copied and compared like
 * `buildProjectEmbeddingSource` below, so the same rule holds: no comments and
 * no annotations inside the body.
 */
export function buildProgramLabel(
  courseId: string,
  courseName: string
): string {
  return `${courseId} ${courseName}`;
}

/**
 * Assembles the exact string that gets embedded.
 *
 * Copied byte for byte into `scripts/backfill-embeddings.mjs`, which the
 * production image ships without any `src/` to import (ADR-0024), and compared
 * with whitespace collapsed by `src/test/backfill-embeddings-parity.test.ts`.
 * So keep this body comment-free and annotation-free: a comment inside it, or
 * the type predicate that used to sit on the `filter` below, fails a
 * comparison an `.mjs` cannot match. Explain above the function, the way this
 * does. `section`, `buildProgramLabel` and `embeddingHash` are under the same
 * rule; the parity test's `it` names are the inventory, not this comment.
 */
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
  ].filter((part) => part !== null);
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
