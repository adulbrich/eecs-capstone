/**
 * Reduces markdown source to plain text for clamped summaries: the listing
 * excerpt (`descriptionExcerpt`) and the social preview (`socialDescription`).
 *
 * Deliberately regex-based rather than a real parser: this runs on the server
 * once per row of every listing read, and the output is cut to an excerpt
 * anyway. It is not a sanitizer and must never be used to render untrusted
 * markup; use the `Markdown` component for display.
 *
 * No failed match may rescan text an earlier failed match already covered
 * (#765). Before that rule, every opener with no closer scanned to the end of
 * the string, so 20,000 characters of `**a ` took 64 ms and four times the
 * length cost about sixteen times the time. Each pattern below that scans for
 * a closer says how it keeps the call linear. Code fences and inline code need
 * nothing: every later opener is also a closer, so a scan ends at the next one.
 */
const CODE_FENCE = /```[\s\S]*?```/g;
const INLINE_CODE = /`([^`]*)`/g;
// Stands in for an inline code span while the other patterns run, so emphasis
// and tag removal cannot reach into `__init__` or `<canvas>`. A private-use
// character, which no proposer types.
const CODE_SLOT = /(\d+)/g;
const HORIZONTAL_RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm;
// A GFM table delimiter row, e.g. `| --- | :--: |`: a line made up only of
// pipes, colons, hyphens, and whitespace. The lookahead requires at least one
// `|` on the line so this never matches a `- - -` horizontal rule (no pipe)
// or a `- item` bullet line (starts with a list marker, not a pipe).
const TABLE_SEPARATOR_ROW = /^(?=[^\n]*\|)[\s:|-]+$/gm;
// A label stops at the next `[` or `]`, and a target at the next `[`, `(` or
// `)` outside one balanced pair, which is where the next opener starts. So no
// two failed scans cover the same text. The balanced pairs keep `?q[]=1` and
// Wikipedia's `Rust_(programming_language)` inside the target. Nested brackets
// in a label never matched.
const IMAGE = /!\[[^[\]]*\]\((?:[^()[\]]|\[[^()[\]]*\]|\([^()[\]]*\))*\)/g;
const LINK = /\[([^[\]]*)\]\((?:[^()[\]]|\[[^()[\]]*\]|\([^()[\]]*\))*\)/g;
const HEADING_MARKER = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE_MARKER = /^\s{0,3}>\s?/gm;
// `[ \t]*`, not `\s*`: under the `m` flag `\s` crosses newlines, so every line
// start in a run of blank lines rescanned the rest of the run for a marker.
const LIST_MARKER = /^[ \t]*([*+-]|\d+[.)])\s+/gm;
const TASK_MARKER = /^\[[ xX]\]\s+/gm;
// Emphasis opens inside its own span, so only a bound helps: 500 characters,
// counted in UTF-16 code units. A longer run keeps its markers, as unclosed
// emphasis does. `(?!\*)` and `(?!_)` take the whole delimiter run at once;
// backing off to a shorter one walked the window up to three times.
const ASTERISK_EMPHASIS = /(\*{1,3}(?!\*)|~~(?!~))(?=\S)([\s\S]{0,499}?\S)\1/g;
// Guarded on both sides so it cannot fire inside a word. CommonMark makes the
// same distinction for the same reason: `*` may emphasise intraword and `_`
// may not, because `snake_case_names` are ordinary prose in a technical field.
const UNDERSCORE_EMPHASIS =
  /(^|[^\w])_{1,3}(?!_)(?=\S)([\s\S]{0,499}?\S)_{1,3}(?!\w)/g;
// An element or a comment. The name must end at whitespace, `/` or `>`, so
// `a < b`, an autolink `<https://x.test>` and `<me@x.test>` survive. `[^<>]`
// stops at the next `<`, which keeps an unclosed tag from scanning past the
// one after it.
const HTML_TAG = /<(?:\/?[A-Za-z][A-Za-z0-9-]*(?=[\s/>])|!)[^<>]*>/g;
// Remaining table pipes (header and data rows) become spaces so cell text
// survives as separate words instead of running together.
const PIPE = /\|/g;
const WHITESPACE = /\s+/g;

export function stripMarkdown(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  const code: string[] = [];
  return input
    .replace(CODE_FENCE, " ")
    .replace(INLINE_CODE, (_, content: string) => {
      code.push(content);
      return `${code.length - 1}`;
    })
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
    .replace(HTML_TAG, " ")
    .replace(PIPE, " ")
    .replace(CODE_SLOT, (slot, index: string) => code[Number(index)] ?? slot)
    .replace(WHITESPACE, " ")
    .trim();
}
