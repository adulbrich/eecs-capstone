/**
 * The text that goes in `og:description` and `twitter:description`.
 *
 * Client-safe and dependency-free apart from the brand, because `head()` runs
 * on both sides of the SSR boundary.
 *
 * Two jobs. `stripMarkdown` exists because `projects.description` and
 * `projects.problemStatement` are Markdown that the detail page renders through
 * the `Markdown` component: pasted raw into a meta tag, a heading's `#` and a
 * link's bracket syntax reach the preview card verbatim. And the fallback chain
 * in `socialDescription` is what actually runs most of the time, since the
 * generated summary is null on every project that has not been published since
 * the column landed, and stays null whenever Bedrock is unavailable.
 */
import { brand } from "./brand";

/**
 * Meta descriptions are cut somewhere near this by every consumer, and the
 * exact point differs per platform. Truncating here rather than letting them do
 * it keeps the cut on a word boundary instead of mid-syllable.
 */
export const SOCIAL_DESCRIPTION_MAX_LENGTH = 160;

/**
 * The last resort in the chain, and the description on every page that has
 * nothing more specific to say. Deliberately a sentence about the app rather
 * than a tagline: this is what a link to the inventory list or a sign-in page
 * unfurls with.
 */
export const SITE_DESCRIPTION = `Propose a capstone project, follow it through staff review into the public catalog, and borrow the equipment your team needs at ${brand.institutionName}.`;

/**
 * The preview card every page shares, shipped in `public/` rather than imported
 * and hashed into `/assets/` the way `brand.ts` handles the logo. Scrapers
 * cache per URL, so a content hash in the filename would orphan every preview
 * already scraped on each redesign. `scripts/generate-social-card.mjs` rebuilds
 * the file; `docs/QUIRKS.md` says why it is committed rather than generated at
 * build time.
 */
export const SOCIAL_CARD_PATH = "/social-card.png";

/**
 * The tag that keeps a page out of search results, spelled once so the nine
 * routes carrying it cannot drift.
 *
 * Not `robots.txt`, which stays permissive on purpose. A `Disallow` bans the
 * fetch, and the preview scrapers honour it, so it would take the unfurls this
 * whole feature exists for with it. This tag is read only by indexers and
 * leaves scrapers alone, which is what lets the catalog be unlisted and
 * shareable at the same time (#498).
 *
 * `follow` rather than `nofollow`: a crawler should still walk from the catalog
 * to whatever it links, it just should not list these pages.
 */
export const NOINDEX = { content: "noindex, follow", name: "robots" } as const;

/**
 * Alt text for that card, which carries its meaning as pixels. Without it a
 * screen reader on a platform that surfaces `og:image:alt` gets nothing.
 */
export const SOCIAL_CARD_ALT = `${brand.institutionName} ${brand.programName}, School of Electrical Engineering and Computer Science`;

// Biome wants regex literals at the top level, and these are hot enough to
// deserve it anyway: `socialDescription` can run three of them per request.
const CODE_FENCE = /```[\s\S]*?```/g;
const IMAGE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK = /\[([^\]]*)\]\([^)]*\)/g;
const INLINE_CODE = /`([^`]*)`/g;
const HEADING = /^\s{0,3}#{1,6}\s+/gm;
const BLOCKQUOTE = /^\s{0,3}>\s?/gm;
const BULLET = /^\s{0,3}[-*+]\s+/gm;
const ORDERED = /^\s{0,3}\d+\.\s+/gm;
const RULE = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm;
const ASTERISK_EMPHASIS = /(\*{1,3})(\S(?:[\s\S]*?\S)?)\1/g;
/**
 * Underscore emphasis, guarded on both sides so it cannot fire inside a word.
 * CommonMark makes the same distinction and for the same reason: `*` may
 * emphasise intraword, `_` may not, because `snake_case_names` are ordinary
 * prose in a technical field. Without the guards, "refresh_social_summary"
 * comes out as "refreshsocialsummary" with no sign anything was lost.
 */
const UNDERSCORE_EMPHASIS =
  /(?<![A-Za-z0-9_])(_{1,3})(\S(?:[\s\S]*?\S)?)\1(?![A-Za-z0-9_])/g;
const STRIKETHROUGH = /~~([\s\S]*?)~~/g;
const HTML_TAG = /<[^>]*>/g;
const WHITESPACE = /\s+/g;
const TRAILING_PUNCTUATION = /[\s,;:.!?-]+$/;

/**
 * Markdown to plain prose, for a single line of preview text.
 *
 * Not a parser and not trying to be: it removes the syntax a proposer actually
 * types into these two fields. A construct it does not know survives as its own
 * characters, which is the right failure for a meta tag. A link keeps its label
 * and loses its target, because the target is noise in a preview and would eat
 * most of the budget.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(CODE_FENCE, " ")
    .replace(IMAGE, " ")
    .replace(LINK, "$1")
    .replace(INLINE_CODE, "$1")
    .replace(RULE, " ")
    .replace(HEADING, "")
    .replace(BLOCKQUOTE, "")
    .replace(BULLET, "")
    .replace(ORDERED, "")
    .replace(STRIKETHROUGH, "$1")
    .replace(ASTERISK_EMPHASIS, "$2")
    .replace(UNDERSCORE_EMPHASIS, "$2")
    .replace(HTML_TAG, " ")
    .replace(WHITESPACE, " ")
    .trim();
}

/**
 * Three ASCII dots, not U+2026. `button-conventions.test.ts` bans the real
 * ellipsis character anywhere in `src`, and the rule is worth keeping here
 * even though this is not a button label: one convention beats two.
 */
const ELLIPSIS = "...";

/**
 * Cuts to at most `max` characters, on a word boundary, with the ellipsis
 * fitting inside the budget rather than pushing past it.
 *
 * A string with no space before the limit is cut at the limit: a single
 * unbroken token that long is a URL or a paste accident, and returning nothing
 * would be worse than returning a fragment.
 */
export function truncateOnWordBoundary(
  text: string,
  max: number = SOCIAL_DESCRIPTION_MAX_LENGTH
): string {
  if (text.length <= max) {
    return text;
  }
  const room = max - ELLIPSIS.length;
  const cut = text.slice(0, room);
  // When the character just past the cut is a space, the cut already ends on a
  // whole word and backing up to the previous space would throw that word away
  // for nothing. Only an actual mid-word cut needs to retreat.
  const boundary = text[room] === " " ? cut.length : cut.lastIndexOf(" ");
  const body = boundary > 0 ? cut.slice(0, boundary) : cut;
  return `${body.replace(TRAILING_PUNCTUATION, "")}${ELLIPSIS}`;
}

/** The fields `socialDescription` reads, named structurally. */
export interface SocialDescriptionSource {
  description?: string | null;
  problemStatement?: string | null;
  socialSummary?: string | null;
}

function usable(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const plain = stripMarkdown(value);
  return plain ? truncateOnWordBoundary(plain) : null;
}

/**
 * The generated summary, else the description, else the problem statement,
 * else the site's own sentence. Never empty, because an absent
 * `og:description` unfurls as a bare title.
 *
 * The summary goes through `stripMarkdown` like the other two. It is written by
 * a model that was asked for one plain sentence, which is not the same as being
 * guaranteed to return one.
 */
export function socialDescription(source: SocialDescriptionSource): string {
  return (
    usable(source.socialSummary) ??
    usable(source.description) ??
    usable(source.problemStatement) ??
    SITE_DESCRIPTION
  );
}
