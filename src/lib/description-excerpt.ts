import { truncateOnWordBoundary } from "./social-meta";
import { stripMarkdown } from "./strip-markdown";

/**
 * The listing card's excerpt budget, ellipsis included. The card's text
 * column is about 700px wide at the listing's `max-w-4xl` beside the 160px
 * image, so its three `text-sm` lines hold roughly 300 to 320 characters. A
 * narrower card clamps the rest in CSS, as it always did.
 */
export const LISTING_EXCERPT_LENGTH = 320;

/**
 * A project's description as plain text, cut to `max` characters on a word
 * boundary, or `null` when nothing is left to show (#761).
 *
 * Stripped before it is cut, never after: a cut through raw markdown can
 * leave half a link, `[text](ht`, that the stripper no longer recognises and
 * passes through as literal brackets.
 */
export function descriptionExcerpt(
  description: string | null | undefined,
  max: number
): string | null {
  return truncateOnWordBoundary(stripMarkdown(description), max) || null;
}
