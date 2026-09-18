import { z } from "zod";

/**
 * The longest search string any listing runs. One number for all eight of
 * them: `searchProjects`, `listAdminProjects`, the two user searches, the
 * mentor list and the three inventory queries, which disagreed before #478
 * (four rejected past 200, four accepted any length).
 *
 * The number itself is not interesting; what matters is that a query past it
 * narrows rather than fails, and that the reader is told so.
 */
export const SEARCH_QUERY_MAX = 200;

/**
 * A raw search string as the server will use it, and whether that meant
 * cutting it.
 *
 * Trim first, cut second, the order `z.string().trim().max(200)` used before
 * #478: 215 characters with 195 left after trimming is not a long query and
 * must not read as one. The cut is by UTF-16 code unit, the same unit the
 * `.max()` it replaces counted, so the cap covers the same strings it always
 * did.
 *
 * The UI derives its note from this function rather than from a flag on the
 * response, because truncation is a fact about the string alone. Contrast
 * `order` on the search result, which the server has to report because it
 * resolves against an interest vector the client cannot see.
 */
export function clampSearchQuery(raw: string): {
  query: string;
  truncated: boolean;
} {
  const trimmed = raw.trim();
  if (trimmed.length <= SEARCH_QUERY_MAX) {
    return { query: trimmed, truncated: false };
  }
  // A cut that lands between the two halves of a surrogate pair, which is
  // what an emoji is, would send a lone half to Postgres; the driver turns
  // that into a replacement character, so the query the reader is told about
  // would end in a glyph they never typed. Drop the orphaned half instead.
  const splitsPair =
    isHighSurrogate(trimmed.charCodeAt(SEARCH_QUERY_MAX - 1)) &&
    isLowSurrogate(trimmed.charCodeAt(SEARCH_QUERY_MAX));
  return {
    query: trimmed.slice(
      0,
      splitsPair ? SEARCH_QUERY_MAX - 1 : SEARCH_QUERY_MAX
    ),
    truncated: true,
  };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd8_00 && code <= 0xdb_ff;
}

function isLowSurrogate(code: number): boolean {
  return code >= 0xdc_00 && code <= 0xdf_ff;
}

/**
 * The `q` (or `query`) field of every search schema under `src/server/`.
 *
 * It clamps rather than rejects, and it clamps on the server, so a caller
 * that skips the UI is safe too: a server function is reachable without it,
 * which is why a `maxLength` on each input would not have been enough. A 201
 * character query used to throw out of `.parse` and land the public listing
 * in the framework's default error page (#478).
 *
 * `.overwrite` rather than `.transform` so the field stays a `ZodString` and
 * a caller can still refine it. `search-query-schemas.test.ts` fails a search
 * field that goes back to a bare `z.string()`.
 */
export const searchQuerySchema = z
  .string()
  .overwrite((value) => clampSearchQuery(value).query)
  .default("");
