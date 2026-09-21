import { createHash } from "node:crypto";

/**
 * The text a social summary is written from, and its hash. Server-imported
 * only (node:crypto), in the shape of `scope-assessment-source.ts` and
 * `embedding-source.ts`: pure, no DB, no AWS, so the staleness rule is
 * unit-testable.
 *
 * Three fields and no more. The summary is published as a page's
 * `og:description`, so anything the model can read is something it can leak
 * into a preview card: the private notes, the contact name and address, the
 * sponsorship flag and the mentor fields are all absent here by design, not by
 * the prompt asking nicely.
 */

export interface SocialSummarySourceProject {
  description: string | null;
  problemStatement: string | null;
  title: string;
}

/**
 * Model-facing tags rather than labels a reader sees, for the same reason
 * `SCOPE_FIELDS` keeps its own spellings: this text feeds the hash that
 * decides whether a stored summary is current, so renaming a tag marks every
 * project stale and charges a model call each to recover.
 */
const SUMMARY_FIELDS = [
  ["title", "Title"],
  ["description", "Description"],
  ["problemStatement", "Problem statement"],
] as const;

/**
 * The character ceiling on what is sent. A capstone description runs to a few
 * thousand characters at most, so this bites only on a paste accident, where
 * truncating beats paying for tokens nobody reads. The truncated string is
 * what the hash covers, so changing this number regenerates every project
 * longer than the smaller of the old value and the new one.
 */
export const SOCIAL_SUMMARY_SOURCE_LIMIT = 12_000;

export function buildSocialSummarySource(
  project: SocialSummarySourceProject
): string {
  const parts: string[] = [];
  for (const [key, label] of SUMMARY_FIELDS) {
    const value = project[key]?.trim();
    if (value) {
      parts.push(`<${label}>\n${value}\n</${label}>`);
    }
  }
  return parts.join("\n\n").slice(0, SOCIAL_SUMMARY_SOURCE_LIMIT);
}

/**
 * The model id is in the hash, so switching models regenerates rather than
 * leaving a mix of two models' prose across the catalog with nothing to say
 * which is which. `embeddingHash` folds in its dimensions for the same reason.
 */
export function socialSummaryHash(source: string, modelId: string): string {
  return createHash("sha256").update(`${modelId}:${source}`).digest("hex");
}
