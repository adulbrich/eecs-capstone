import { createHash } from "node:crypto";

/**
 * The text a scope assessment is computed from, and its hash. Server-imported
 * only (node:crypto), in the shape of `embedding-source.ts`: pure, no DB, no
 * AWS, so the staleness rule is unit-testable.
 */

export interface ScopeSourceProject {
  description: string | null;
  minQualifications: string | null;
  objectives: string | null;
  prefQualifications: string | null;
  problemStatement: string | null;
  teamsSupported: number;
  title: string;
}

export interface ScopeSourceProgram {
  label: string;
  termCount: number | null;
}

/**
 * Model-facing tags, not labels a reader sees, so they do not follow
 * FIELD_LABELS in project-review-fields.ts: the label text is part of the
 * source this module hashes, and renaming one marks every stored scope
 * assessment stale (#375 kept them as they were for that reason).
 */
const SCOPE_FIELDS = [
  ["title", "Title"],
  ["description", "Description"],
  ["problemStatement", "Problem statement"],
  ["objectives", "Objectives / deliverables"],
  ["minQualifications", "Minimum qualifications"],
  ["prefQualifications", "Preferred qualifications"],
] as const;

function programPhrase(program: ScopeSourceProgram): string {
  const terms =
    program.termCount === null
      ? "term count not set"
      : `runs ${program.termCount} ${program.termCount === 1 ? "term" : "terms"}`;
  return `${program.label} (${terms})`;
}

/**
 * A project runs in zero, one or many programs (#462). The empty and single
 * cases must render exactly the strings they always have, or every stored
 * verdict reads as stale and staff re-run them at Bedrock cost each; the
 * many case is the only new output. Sorted by label so the caller's order
 * cannot move the hash.
 */
function programLine(programs: ScopeSourceProgram[]): string {
  if (programs.length === 0) {
    return "This proposal names no program.";
  }
  // Codepoint order, not `localeCompare`: this feeds the hash that decides
  // whether a stored verdict is stale, and a locale or runtime change must
  // not silently move it.
  const sorted = [...programs].sort((a, b) => {
    if (a.label === b.label) {
      return 0;
    }
    return a.label < b.label ? -1 : 1;
  });
  if (sorted.length === 1) {
    return `${programPhrase(sorted[0])}.`;
  }
  return `This proposal runs in ${sorted.length} programs: ${sorted
    .map(programPhrase)
    .join("; ")}.`;
}

/**
 * The program line is part of the source on purpose: changing a program's
 * term count, or moving the project, is a reason the verdict may no longer
 * hold, so it changes the hash and the stored assessment reads as stale.
 */
export function buildScopeSource(
  project: ScopeSourceProject,
  programs: ScopeSourceProgram[]
): string {
  const parts = [`<program>\n${programLine(programs)}\n</program>`];
  parts.push(`Teams supported: ${project.teamsSupported}`);
  for (const [field, label] of SCOPE_FIELDS) {
    const value = project[field]?.trim();
    if (!value) {
      continue;
    }
    parts.push(`<field name="${field}" label="${label}">\n${value}\n</field>`);
  }
  return parts.join("\n\n");
}

export function scopeSourceHash(source: string, modelId: string): string {
  return createHash("sha256").update(`${modelId}:${source}`).digest("hex");
}
