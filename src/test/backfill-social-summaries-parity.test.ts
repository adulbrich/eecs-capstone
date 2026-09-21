import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The social summary backfill is two scripts, split by runtime rather than by
 * responsibility:
 *
 * - `scripts/backfill-social-summaries.ts` runs on a workstation and calls the
 *   app's own `refreshSocialSummary`, so it has nothing to keep in sync.
 * - `scripts/backfill-social-summaries.mjs` runs from the production image,
 *   which installs with `npm ci --omit=dev` (no `tsx`) and ships `.output`
 *   without `src/`. Nothing under `#/lib` resolves there, so it carries its own
 *   copy of what it needs.
 *
 * What crosses that boundary is whatever carries a `MUST match` comment in the
 * script, and the `it` names below are the inventory of which of those are
 * pinned, per `docs/adr/0024-ops-scripts-are-plain-mjs.md`.
 *
 * What is pinned is whatever drifts silently or expensively. Worst first:
 *
 * - The manual-summary skip drifts. The sweep overwrites wording staff typed
 *   by hand, in a field that is published under the university's name, and
 *   nothing anywhere records that it happened. This is the worst outcome the
 *   feature has and it is completely silent.
 * - The summarised text drifts. The script stores summaries written from text
 *   the app would never produce for that project, beside a hash the app then
 *   reads as current, so nothing ever recomputes them.
 * - The rest of the skip rule drifts. Silent in one direction and expensive in
 *   the other: lose the `hasSummary` half and a row whose write was interrupted
 *   is skipped by every sweeper forever with nothing to say so; lose the hash
 *   half and every run re-summarises everything at one paid call each.
 * - The hash inputs drift, including the model id default. Every row looks
 *   stale to whichever side did not change, so both sides re-summarise rows
 *   that were already correct, at one paid call each, and can flip-flop a row
 *   indefinitely.
 * - The prompt or the tool spec drifts. Not an input to the hash, which is
 *   exactly why it needs pinning: half the catalog ends up summarised in one
 *   voice and half in another, with nothing stored to say which is which and
 *   nothing that would ever recompute them.
 * - The query drifts from what the builder reads. A status added to
 *   `EMBEDDABLE_STATUSES` alone leaves rows the script never sweeps. A field
 *   added to `SocialSummarySourceProject` alone is worse, because the body
 *   comparison then forces the copied builder to read a key the query never
 *   selected, and an absent key reads as an empty field that silently vanishes
 *   from every string the script summarises.
 *
 * Copies whose drift is loud instead (`credentialProvider`, `mantleHost`,
 * `callMantle`) are deliberately not pinned: each one ends in a signing
 * rejection or a transport error on the first row, which stops the run rather
 * than corrupting it.
 *
 * Unlike `backfill-embeddings-parity.test.ts`, this file extracts each pinned
 * body by name and strips comments from that body alone, rather than stripping
 * the whole file first. That is why the script may contain a scheme and this
 * one may mention it: the narrower constraint is that a PINNED BODY carries no
 * comment, no TypeScript annotation and no scheme. Explain above the function.
 *
 * Read as text rather than imported, since importing the `.mjs` would run it
 * and it expects a database.
 */
const SCRIPT = readFileSync("scripts/backfill-social-summaries.mjs", "utf8");
const SOURCE = readFileSync("src/lib/social-summary-source.ts", "utf8");
const SUMMARY = readFileSync("src/lib/social-summary.ts", "utf8");
const CORE = readFileSync(
  "src/server/_internal/social-summary-core.ts",
  "utf8"
);
const WRITER = readFileSync(
  "src/server/_internal/project-social-summary.ts",
  "utf8"
);
const EMBEDDINGS = readFileSync(
  "src/server/_internal/project-embeddings.ts",
  "utf8"
);

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT = /(^|\s)\/\/[^\n]*/g;
// Deliberately excludes whitespace from the character class. With `\s` in it,
// `const parts: string[] = []` lost the space before the `=` as well as the
// annotation, and compared unequal against an `.mjs` that never had one.
const TYPE_ANNOTATION = /:\s*[A-Za-z][\w.<>[\]|]*(?=\s*[,)=;])/g;
const WHITESPACE = /\s+/g;

/**
 * Extracts a pinned region, with the delimiters named per pin rather than
 * guessed.
 *
 * Guessing is what an earlier version did, taking whichever of `{` or `[` came
 * first, and it was wrong in both directions. `function findToolCall(items:
 * MantleOutputItem[], ...)` opens a bracket inside its parameter list, so the
 * body it returned was `[]`. Worse, a template literal has neither delimiter,
 * so the prompt pin matched the first `${...}` on each side and compared it
 * with itself: a test that passed while checking nothing.
 */
function region(
  text: string,
  declaration: string,
  kind: "body" | "literal" | "template"
): string {
  const start = text.indexOf(declaration);
  if (start === -1) {
    throw new Error(`Declaration not found: ${declaration}`);
  }
  // A declaration the caller passed without its `=` may carry a type
  // annotation containing a bracket, as `EMBEDDABLE_STATUSES: readonly
  // ProjectStatus[] =` does. Scanning from the `=` steps past it; scanning
  // from the name alone returned that annotation's empty `[]`.
  const named = start + declaration.length;
  // For a value, a declaration the caller passed without its `=` may carry a
  // type annotation containing a bracket, as `EMBEDDABLE_STATUSES: readonly
  // ProjectStatus[] =` does; scanning from the `=` steps past it. A function
  // must NOT do this: the next `=` after its name is somewhere in its body.
  const after =
    kind !== "body" && !declaration.trimEnd().endsWith("=")
      ? text.indexOf("=", named) + 1
      : named;
  if (kind === "template") {
    const open = text.indexOf("`", after);
    const close = text.indexOf("`", open + 1);
    if (open === -1 || close === -1) {
      throw new Error(`No template literal for: ${declaration}`);
    }
    return text.slice(open, close + 1);
  }
  // A function's body always starts at the first brace after its parameter
  // list, which is the first brace after the closing paren.
  const from =
    kind === "body"
      ? text.indexOf("{", text.indexOf(")", after - 1))
      : firstOf(text, after, "[{");
  if (from === -1) {
    throw new Error(`No opening delimiter for: ${declaration}`);
  }
  const opener = text[from] as string;
  const closer = opener === "[" ? "]" : "}";
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    if (text[i] === opener) {
      depth += 1;
    } else if (text[i] === closer) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(from, i + 1);
      }
    }
  }
  throw new Error(`Unbalanced region for: ${declaration}`);
}

function firstOf(text: string, from: number, chars: string): number {
  for (let i = from; i < text.length; i++) {
    if (chars.includes(text[i] as string)) {
      return i;
    }
  }
  return -1;
}

/** Comparable form: comments and type annotations gone, whitespace collapsed. */
function normalize(body: string): string {
  return body
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, " ")
    .replace(TYPE_ANNOTATION, "")
    .replace(WHITESPACE, " ")
    .trim();
}

function same(
  scriptDecl: string,
  srcText: string,
  srcDecl: string,
  kind: "body" | "literal" | "template" = "body"
) {
  const fromScript = region(SCRIPT, scriptDecl, kind);
  const fromSource = region(srcText, srcDecl, kind);
  // A pin that matched an empty or near-empty region would pass while checking
  // nothing, which is exactly how the template-literal bug hid.
  expect(fromScript.length).toBeGreaterThan(30);
  expect(normalize(fromScript)).toBe(normalize(fromSource));
}

/** A pinned body must not carry what the comparison cannot strip safely. */
function assertComparable(decl: string, kind: "body" | "literal" = "body") {
  expect(region(SCRIPT, decl, kind)).not.toContain("://");
}

describe("the social summary backfill script", () => {
  it("skips a summary staff wrote by hand, before anything else", () => {
    // The manual test must come first and must be `continue`, not a fallthrough
    // that later overwrites. Pinned against the script's text rather than a
    // body comparison, because the app's copy is an early return inside a
    // larger function and the script's is a loop guard.
    expect(normalize(SCRIPT)).toContain(
      "if (project.socialSummaryIsManual) { tally.manual += 1; continue; }"
    );
    expect(normalize(WRITER)).toContain(
      'if (project.socialSummaryIsManual) { return "manual"; }'
    );
  });

  it("builds the summarised text the same way", () => {
    assertComparable("function buildSocialSummarySource(");
    same(
      "function buildSocialSummarySource(",
      SOURCE,
      "export function buildSocialSummarySource("
    );
  });

  it("names the same source fields, in the same order", () => {
    same("const SUMMARY_FIELDS =", SOURCE, "const SUMMARY_FIELDS =", "literal");
  });

  it("hashes the same way", () => {
    assertComparable("function socialSummaryHash(");
    same(
      "function socialSummaryHash(",
      SOURCE,
      "export function socialSummaryHash("
    );
  });

  it("reads the same model id default, which is a hash input", () => {
    same(
      "function buildSocialSummaryConfig(",
      CORE,
      "export function buildSocialSummaryConfig("
    );
  });

  it("caps the source text at the same length, which the hash covers", () => {
    expect(SCRIPT).toContain("const SOCIAL_SUMMARY_SOURCE_LIMIT = 12_000;");
    expect(SOURCE).toContain(
      "export const SOCIAL_SUMMARY_SOURCE_LIMIT = 12_000;"
    );
  });

  it("rejects an over-long summary at the same cap", () => {
    expect(SCRIPT).toContain("const SOCIAL_SUMMARY_MAX_LENGTH = 300;");
    expect(SUMMARY).toContain("export const SOCIAL_SUMMARY_MAX_LENGTH = 300;");
  });

  it("sends the same system prompt", () => {
    same(
      "const SOCIAL_SUMMARY_SYSTEM_PROMPT =",
      CORE,
      "export const SOCIAL_SUMMARY_SYSTEM_PROMPT =",
      "template"
    );
  });

  it("declares the same tool", () => {
    same(
      "const socialSummaryToolSpec =",
      CORE,
      "export const socialSummaryToolSpec =",
      "literal"
    );
  });

  it("names the same tool and the same output ceiling", () => {
    expect(SCRIPT).toContain(
      'const SOCIAL_SUMMARY_TOOL_NAME = "write_social_summary";'
    );
    expect(CORE).toContain(
      'export const SOCIAL_SUMMARY_TOOL_NAME = "write_social_summary";'
    );
    expect(SCRIPT).toContain("const SOCIAL_SUMMARY_MAX_OUTPUT_TOKENS = 1200;");
    expect(CORE).toContain(
      "export const SOCIAL_SUMMARY_MAX_OUTPUT_TOKENS = 1200;"
    );
  });

  it("reads a tool call out of the response the same way", () => {
    assertComparable("function findToolCall(");
    same(
      "function findToolCall(",
      readFileSync("src/lib/_internal/bedrock-mantle.ts", "utf8"),
      "export function findToolCall("
    );
  });

  it("sweeps the same statuses the app summarises", () => {
    // A status added to EMBEDDABLE_STATUSES alone would leave rows this script
    // never visits. The app's set is a const; the script's is SQL.
    expect(
      normalize(region(EMBEDDINGS, "EMBEDDABLE_STATUSES", "literal"))
    ).toBe('[ "published", "archived", ]');
    expect(SCRIPT).toContain("WHERE status IN ('published', 'archived')");
  });

  it("selects every column the copied builder reads", () => {
    // The subtle one: the body comparison above forces the script's builder to
    // read these keys, and an absent key reads as an empty field rather than
    // as an error, so the section vanishes from the summarised text silently.
    const selected = region(SCRIPT, "const SELECT_SQL =", "template");
    for (const key of ["title", "description", "problemStatement"]) {
      expect(selected).toContain(key);
    }
    // And the three the skip rule reads.
    for (const key of [
      "socialSummarySourceHash",
      "socialSummaryIsManual",
      "hasSummary",
    ]) {
      expect(selected).toContain(key);
    }
  });

  it("applies the same staleness rule as the app's writer", () => {
    expect(normalize(SCRIPT)).toContain(
      "if (project.socialSummarySourceHash === hash && project.hasSummary)"
    );
    expect(normalize(WRITER)).toContain(
      "if (project.socialSummarySourceHash === hash && project.socialSummary)"
    );
  });

  it("never claims a generated summary as staff-written", () => {
    // The update must not touch social_summary_is_manual. If it did, one sweep
    // would freeze every project it touched out of the automatic path forever.
    const update = region(SCRIPT, "const UPDATE_SQL =", "template");
    expect(update).not.toContain("social_summary_is_manual");
  });

  it("proves the comment strip ran and kept the code", () => {
    // Guards the normalizer itself: if the strip ate real code, or stripped
    // nothing, every comparison above would pass vacuously.
    const body = region(SCRIPT, "function buildSocialSummarySource(", "body");
    expect(body.length).toBeGreaterThan(50);
    expect(normalize(body)).toContain("parts.join");
    expect(normalize("const a = 1; // gone")).toBe("const a = 1;");
    expect(normalize("const a = 1; /* gone */")).toBe("const a = 1;");
  });
});
