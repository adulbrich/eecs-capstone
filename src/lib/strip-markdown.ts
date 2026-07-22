/**
 * Reduces markdown source to plain text for clamped summaries (cards, rows).
 *
 * Deliberately regex-based rather than a real parser: this runs once per card
 * on every listing render, and the output is truncated by `line-clamp`
 * anyway. It is not a sanitizer and must never be used to render untrusted
 * markup; use the `Markdown` component for display.
 */
const CODE_FENCE = /```[\s\S]*?```/g;
const HORIZONTAL_RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/gm;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const HEADING_MARKER = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE_MARKER = /^\s{0,3}>\s?/gm;
const LIST_MARKER = /^\s*([*+-]|\d+[.)])\s+/gm;
const ASTERISK_EMPHASIS = /(\*{1,3}|~~)(?=\S)([\s\S]*?\S)\1/g;
const UNDERSCORE_EMPHASIS = /(^|[^\w])_{1,3}(?=\S)([\s\S]*?\S)_{1,3}(?!\w)/g;
const INLINE_CODE = /`([^`]*)`/g;
const WHITESPACE = /\s+/g;

export function stripMarkdown(input: string | null | undefined): string {
  if (!input) {
    return "";
  }
  return input
    .replace(CODE_FENCE, " ")
    .replace(HORIZONTAL_RULE, " ")
    .replace(IMAGE, "")
    .replace(LINK, "$1")
    .replace(HEADING_MARKER, "")
    .replace(BLOCKQUOTE_MARKER, "")
    .replace(LIST_MARKER, "")
    .replace(ASTERISK_EMPHASIS, "$2")
    .replace(UNDERSCORE_EMPHASIS, "$1$2")
    .replace(INLINE_CODE, "$1")
    .replace(WHITESPACE, " ")
    .trim();
}
