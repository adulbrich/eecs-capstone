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
  label: string | null;
  termCount: number | null;
}

const SCOPE_FIELDS = [
  ["title", "Title"],
  ["description", "Description"],
  ["problemStatement", "Problem statement"],
  ["objectives", "Objectives / deliverables"],
  ["minQualifications", "Minimum qualifications"],
  ["prefQualifications", "Preferred qualifications"],
] as const;

function programLine(program: ScopeSourceProgram): string {
  if (!program.label) {
    return "This proposal names no program.";
  }
  const terms =
    program.termCount === null
      ? "term count not set"
      : `runs ${program.termCount} ${program.termCount === 1 ? "term" : "terms"}`;
  return `${program.label} (${terms}).`;
}

/**
 * The program line is part of the source on purpose: changing a program's
 * term count, or moving the project, is a reason the verdict may no longer
 * hold, so it changes the hash and the stored assessment reads as stale.
 */
export function buildScopeSource(
  project: ScopeSourceProject,
  program: ScopeSourceProgram
): string {
  const parts = [`<program>\n${programLine(program)}\n</program>`];
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
