/**
 * A high surrogate with no low surrogate after it, at the end of a string.
 * Copied into `scripts/backfill-social-summaries.mjs` and
 * `scripts/backfill-embeddings.mjs`, whose parity tests pin both copies
 * against this one.
 */
const LONE_TRAILING_SURROGATE = /[\uD800-\uDBFF]$/u;

/**
 * The first `end` UTF-16 code units of `text`, less half a character.
 *
 * `String.prototype.slice` counts code units, and anything outside the basic
 * plane, an emoji above all, is two of them. A cut between the pair leaves a
 * lone high surrogate, which is not a character at all: encoded to UTF-8 it
 * becomes a replacement glyph in a meta tag, a lone escape in the JSON sent to
 * Bedrock, or a glyph in a search the reader never typed. The fix landed four
 * times by hand before this helper (#490, #582, #696, #836).
 *
 * The strip runs whether or not anything was cut, which is what the embedding
 * source has always done; the social summary source calls this only when its
 * value is longer than the room, and keeps that test, because both texts feed
 * a stored hash and must not change by one character.
 *
 * `end` is a length, so never negative: `slice` reads a negative end as an
 * offset from the end of the string. `truncateOnWordBoundary` clamps before
 * it calls.
 *
 * The body stays free of comments and type annotations, because the two
 * parity tests compare it with the scripts' copies as text.
 */
export function sliceWellFormed(text: string, end: number): string {
  return text.slice(0, end).replace(LONE_TRAILING_SURROGATE, "");
}
