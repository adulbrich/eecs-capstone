/**
 * Reduces markdown source to plain text for clamped summaries: the listing
 * excerpt (`descriptionExcerpt`) and the social preview (`socialDescription`).
 *
 * Deliberately regex-based rather than a real parser: this runs on the server
 * once per row of every listing read, and the output is cut to an excerpt
 * anyway. It is not a sanitizer and must never be used to render untrusted
 * markup; use the `Markdown` component for display.
 *
 * No pattern may scan for a closer without limit (#765). An unlimited span
 * rescans to the end of the string from every opener that has no closer, so
 * 20,000 characters of `**a ` took 64 ms, and four times the length cost about
 * sixteen times the time. Two fixes keep every call linear in its input:
 *
 * - A link or image stops scanning at the next `[` or `]`, which is where the
 *   next opener starts, so no two failed scans cover the same text. Nested
 *   brackets never matched anyway.
 * - Emphasis stops after 500 characters. Its openers can sit inside its own
 *   span, so only a bound helps; a longer run keeps its markers, as unclosed
 *   emphasis does.
 */
const CODE_FENCE = /```[\s\S]*?```/g;
const HORIZONTAL_RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm;
// A GFM table delimiter row, e.g. `| --- | :--: |`: a line made up only of
// pipes, colons, hyphens, and whitespace. The lookahead requires at least one
// `|` on the line so this never matches a `- - -` horizontal rule (no pipe)
// or a `- item` bullet line (starts with a list marker, not a pipe).
const TABLE_SEPARATOR_ROW = /^(?=[^\n]*\|)[\s:|-]+$/gm;
const IMAGE = /!\[[^[\]]*\]\([^)[\]]*\)/g;
const LINK = /\[([^[\]]*)\]\([^)[\]]*\)/g;
const HEADING_MARKER = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE_MARKER = /^\s{0,3}>\s?/gm;
// `[ \t]*`, not `\s*`: under the `m` flag `\s` crosses newlines, so every line
// start in a run of blank lines rescanned the rest of the run for a marker.
const LIST_MARKER = /^[ \t]*([*+-]|\d+[.)])\s+/gm;
const TASK_MARKER = /^\[[ xX]\]\s+/gm;
const ASTERISK_EMPHASIS = /(\*{1,3}|~~)(?=\S)([\s\S]{0,500}?\S)\1/g;
// Guarded on both sides so it cannot fire inside a word. CommonMark makes the
// same distinction for the same reason: `*` may emphasise intraword and `_`
// may not, because `snake_case_names` are ordinary prose in a technical field.
const UNDERSCORE_EMPHASIS =
  /(^|[^\w])_{1,3}(?=\S)([\s\S]{0,500}?\S)_{1,3}(?!\w)/g;
const INLINE_CODE = /`([^`]*)`/g;
// A tag starts with a letter, so `a < b` survives. `[^<>]` stops at the next
// `<`, which keeps an unclosed tag from scanning past the one after it.
const HTML_TAG = /<\/?[A-Za-z][^<>]*>/g;
// Remaining table pipes (header and data rows) become spaces so cell text
// survives as separate words instead of running together.
const PIPE = /\|/g;
const WHITESPACE = /\s+/g;

export function stripMarkdown(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  return input
    .replace(CODE_FENCE, " ")
    .replace(HORIZONTAL_RULE, " ")
    .replace(TABLE_SEPARATOR_ROW, " ")
    .replace(IMAGE, " ")
    .replace(LINK, "$1")
    .replace(HEADING_MARKER, "")
    .replace(BLOCKQUOTE_MARKER, "")
    .replace(LIST_MARKER, "")
    .replace(TASK_MARKER, "")
    .replace(ASTERISK_EMPHASIS, "$2")
    .replace(UNDERSCORE_EMPHASIS, "$1$2")
    .replace(INLINE_CODE, "$1")
    .replace(HTML_TAG, " ")
    .replace(PIPE, " ")
    .replace(WHITESPACE, " ")
    .trim();
}
