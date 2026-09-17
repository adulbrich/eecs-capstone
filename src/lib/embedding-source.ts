import { createHash } from "node:crypto";

/**
 * Pure source-text and hash helpers for embeddings. No DB and no AWS imports,
 * so this is trivially unit-testable and safe to import from either side.
 *
 * READ AS TEXT by `src/test/backfill-embeddings-parity.test.ts`, which pins
 * what `scripts/backfill-embeddings.mjs` copies across the production image
 * boundary (ADR-0024). Two constraints on this file follow from that and would
 * otherwise be invisible from here:
 *
 * - No URL anywhere, in a string or a comment. The test strips comments by
 *   regex before matching, and the two slashes in a scheme, inside a string
 *   literal, would make the strip eat real code. Cite a doc by path or by ADR
 *   number, as the JSDoc below does.
 * - Keep `export function buildProjectEmbeddingSource(` spelled exactly that
 *   way. The test looks for it to prove the strip kept the code it removed the
 *   comments from, so a rename has to move in both places at once.
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
 * Assembles the exact string that gets embedded.
 *
 * The project's own prose and nothing else. Its categories and its program are
 * deliberately left out, and `docs/adr/0025-the-embedded-text-is-prose-only.md`
 * is why. In short: both are exact filters on the listing already, the category
 * vocabulary is generic enough that a project carrying a tag almost always says
 * so in its own description, and a course identifier is not language.
 *
 * Copied byte for byte into `scripts/backfill-embeddings.mjs`, which the
 * production image ships without any `src/` to import (ADR-0024), and compared
 * with whitespace collapsed by `src/test/backfill-embeddings-parity.test.ts`.
 * So keep this body comment-free and annotation-free: a comment inside it, or
 * the type predicate that used to sit on the `filter` below, fails a
 * comparison an `.mjs` cannot match. Explain above the function, the way this
 * does. `section` and `embeddingHash` are under the same rule; the parity
 * test's `it` names are the inventory, not this comment.
 */
export function buildProjectEmbeddingSource(
  project: EmbeddableProject
): string {
  const parts = [
    section("Title", project.title),
    section("Description", project.description),
    section("Problem", project.problemStatement),
    section("Objectives", project.objectives),
    section("Minimum qualifications", project.minQualifications),
    section("Preferred qualifications", project.prefQualifications),
    section("License", project.licenseRestrictions),
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
