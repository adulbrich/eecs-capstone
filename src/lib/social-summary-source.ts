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
 * The character ceiling on what is sent, in UTF-16 code units, which is what
 * `String.prototype.length` and `slice` count. A capstone description runs to
 * a few thousand characters at most, so this bites only on a paste accident,
 * where truncating beats paying for tokens nobody reads. The truncated string
 * is what the hash covers, so changing this number regenerates every project
 * longer than the smaller of the old value and the new one.
 */
export const SOCIAL_SUMMARY_SOURCE_LIMIT = 12_000;

/**
 * A high surrogate with no low surrogate after it, at the end of a string.
 * `social-meta.ts` carries its own copy for its own cut; this one is pinned
 * against the backfill script's, so the two cannot drift.
 */
const LONE_TRAILING_SURROGATE = /[\uD800-\uDBFF]$/;

/**
 * The budget is spent field by field rather than by slicing the joined string,
 * which is what put the cut inside the closing tag (#566).
 *
 * Slicing at the end could land anywhere: on any source over the limit the
 * text ended mid-`</Description`, and on a run of emoji it ended on half a
 * character. Both go into `socialSummaryHash`, so the model was handed a
 * malformed prompt and handed the same malformed prompt on every later sweep,
 * with nothing in the row to say why it kept failing.
 *
 * Here a field's tags are only written once its value is known to fit inside
 * them, so the cut is always inside a value and a tag is never half-written.
 * A field that cannot fit at all ends the loop rather than being written
 * empty, because the fields are in descending order of usefulness and a
 * `<Problem statement></Problem statement>` says nothing the model can use.
 *
 * The seven is the punctuation around a value: `<`, `>`, a newline, a newline,
 * `<`, `/`, `>`. The label itself is counted twice, once per tag.
 */
export function buildSocialSummarySource(
  project: SocialSummarySourceProject
): string {
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
    parts.push(`<${label}>\n${body}\n</${label}>`);
    remaining -= separator + wrapper + body.length;
  }
  return parts.join("\n\n");
}

/**
 * The model id is in the hash, so switching models regenerates rather than
 * leaving a mix of two models' prose across the catalog with nothing to say
 * which is which. `embeddingHash` folds in its dimensions for the same reason.
 */
export function socialSummaryHash(source: string, modelId: string): string {
  return createHash("sha256").update(`${modelId}:${source}`).digest("hex");
}
