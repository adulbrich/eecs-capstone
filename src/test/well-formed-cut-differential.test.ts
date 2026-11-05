import { fc, test } from "@fast-check/vitest";
import { describe, expect } from "vitest";
import {
  buildProjectEmbeddingSource,
  EMBEDDING_SOURCE_LIMIT,
} from "#/lib/embedding-source";
import { clampSearchQuery, SEARCH_QUERY_MAX } from "#/lib/search-query";
import { truncateOnWordBoundary } from "#/lib/social-meta";
import {
  buildSocialSummarySource,
  SOCIAL_SUMMARY_SOURCE_LIMIT,
} from "#/lib/social-summary-source";
import { trickyText } from "#/test/shared/arbitraries";

/**
 * TEMPORARY: deleted before #840 merges, as its acceptance criteria say.
 *
 * The four cut sites as they were on `main` at a3ed433a, run against the new
 * ones on generated input. The social summary and embedding sources feed a
 * stored hash, so they must agree on every input, malformed ones included.
 * `clampSearchQuery` now trims after its cut, and may otherwise differ only on
 * a lone high surrogate at the cut with no low one after it.
 */
const LONE_TRAILING_SURROGATE = /[\uD800-\uDBFF]$/u;
const TRAILING_PUNCTUATION = /[\s,;:.!?-]+$/u;

function oldTruncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  if (max < 3) {
    return text.slice(0, Math.max(max, 0)).replace(LONE_TRAILING_SURROGATE, "");
  }
  const room = max - 3;
  const cut = text.slice(0, room);
  const boundary = text[room] === " " ? cut.length : cut.lastIndexOf(" ");
  const body = boundary >= room / 3 ? cut.slice(0, boundary) : cut;
  const trimmed = body.replace(LONE_TRAILING_SURROGATE, "");
  const stripped = trimmed.replace(TRAILING_PUNCTUATION, "");
  return `${stripped || trimmed}...`;
}

const SUMMARY_FIELDS = [
  ["title", "Title"],
  ["description", "Description"],
  ["problemStatement", "Problem statement"],
] as const;

interface SummaryProject {
  description: string | null;
  problemStatement: string | null;
  title: string;
}

function oldSummary(project: SummaryProject): string {
  const parts: string[] = [];
  let remaining = SOCIAL_SUMMARY_SOURCE_LIMIT;
  for (const [key, label] of SUMMARY_FIELDS) {
    const value = project[key]?.trim();
    if (!value) {
      continue;
    }
    const separator = parts.length > 0 ? 2 : 0;
    const wrapper = label.length * 2 + 7;
    const room = remaining - separator - wrapper;
    if (room < 1) {
      break;
    }
    const body =
      value.length > room
        ? value.slice(0, room).replace(LONE_TRAILING_SURROGATE, "")
        : value;
    if (!body) {
      break;
    }
    parts.push(`<${label}>\n${body}\n</${label}>`);
    remaining -= separator + wrapper + body.length;
  }
  return parts.join("\n\n");
}

interface EmbedProject {
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

function oldEmbedding(project: EmbedProject): string {
  const parts = [
    section("Title", project.title),
    section("Description", project.description),
    section("Problem", project.problemStatement),
    section("Objectives", project.objectives),
    section("Minimum qualifications", project.minQualifications),
    section("Preferred qualifications", project.prefQualifications),
    section("License", project.licenseRestrictions),
  ].filter((part) => part !== null);
  return parts
    .join("\n\n")
    .slice(0, EMBEDDING_SOURCE_LIMIT)
    .replace(LONE_TRAILING_SURROGATE, "");
}

function isHigh(code: number): boolean {
  return code >= 0xd8_00 && code <= 0xdb_ff;
}

function isLow(code: number): boolean {
  return code >= 0xdc_00 && code <= 0xdf_ff;
}

function oldClamp(raw: string): { query: string; truncated: boolean } {
  const trimmed = raw.trim();
  if (trimmed.length <= SEARCH_QUERY_MAX) {
    return { query: trimmed, truncated: false };
  }
  const splitsPair =
    isHigh(trimmed.charCodeAt(SEARCH_QUERY_MAX - 1)) &&
    isLow(trimmed.charCodeAt(SEARCH_QUERY_MAX));
  return {
    query: trimmed.slice(
      0,
      splitsPair ? SEARCH_QUERY_MAX - 1 : SEARCH_QUERY_MAX
    ),
    truncated: true,
  };
}

/** Tricky text with lone halves of a pair mixed in, either half. */
const malformed = fc
  .array(
    fc.oneof(
      trickyText({ maxLength: 4 }),
      fc.constantFrom("\uD83D", "\uDE00", "\uDBFF")
    ),
    { maxLength: 12 }
  )
  .map((parts) => parts.join(""));

const anyText = fc.oneof(trickyText({ size: "medium" }), malformed);

/** Text that crosses `limit` code units inside `tail`. */
function across(limit: number, tail: fc.Arbitrary<string>) {
  return fc
    .tuple(fc.integer({ max: 24, min: 0 }), tail)
    .map(([lead, rest]) => "a".repeat(Math.max(limit - lead, 0)) + rest);
}

const RUNS = { numRuns: 3000 };

describe("the old and new cut sites, on generated input", () => {
  test.prop([anyText, fc.integer({ max: 80, min: -5 })], RUNS)(
    "truncateOnWordBoundary agrees on every input",
    (input, max) => {
      expect(truncateOnWordBoundary(input, max)).toBe(oldTruncate(input, max));
    }
  );

  test.prop(
    [
      fc.record({
        title: fc.oneof(
          anyText,
          fc
            .integer({ max: 60, min: -2 })
            .map((room) => "a".repeat(SOCIAL_SUMMARY_SOURCE_LIMIT - 48 - room)),
          across(SOCIAL_SUMMARY_SOURCE_LIMIT - 17, anyText)
        ),
        description: fc.option(anyText),
        problemStatement: fc.option(anyText),
      }),
    ],
    RUNS
  )("buildSocialSummarySource agrees on every input", (project) => {
    expect(buildSocialSummarySource(project)).toBe(oldSummary(project));
  });

  test.prop(
    [
      fc.record({
        title: fc.oneof(anyText, across(EMBEDDING_SOURCE_LIMIT - 7, anyText)),
        description: fc.option(anyText),
        problemStatement: fc.option(anyText),
        objectives: fc.option(anyText),
        minQualifications: fc.option(anyText),
        prefQualifications: fc.option(anyText),
        licenseRestrictions: fc.option(anyText),
      }),
    ],
    RUNS
  )("buildProjectEmbeddingSource agrees on every input", (project) => {
    expect(buildProjectEmbeddingSource(project)).toBe(oldEmbedding(project));
  });

  test.prop([fc.oneof(anyText, across(SEARCH_QUERY_MAX, anyText))], RUNS)(
    "clampSearchQuery agrees after a trim, apart from a lone high half at the cut",
    (raw) => {
      const before = oldClamp(raw);
      const after = clampSearchQuery(raw);
      expect(after.truncated).toBe(before.truncated);
      if (after.query !== before.query.trimEnd()) {
        const trimmed = raw.trim();
        expect(isHigh(trimmed.charCodeAt(SEARCH_QUERY_MAX - 1))).toBe(true);
        expect(isLow(trimmed.charCodeAt(SEARCH_QUERY_MAX))).toBe(false);
      }
    }
  );
});
