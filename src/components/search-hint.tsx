import { clampSearchQuery, SEARCH_QUERY_MAX } from "#/lib/search-query";

/**
 * The line under a listing's search input: what the box searches and the
 * syntax it takes. The input names it through `aria-describedby`, so a
 * screen reader hears it on focus, and it stays on the page at every width
 * and after the reader types, which a placeholder does not (#369, and
 * UI-CONVENTIONS "A placeholder is not a label").
 *
 * Rendered inside the search row, right after the input, as a flex item of
 * its own line (`basis-full`). Below `md` the row wraps, so that line is the
 * one under the input and the sort, the view toggle and the buttons follow
 * it; a hint under the buttons read as a caption for them. From `md`
 * `order-last` moves it under the whole row instead, where the input and
 * the buttons share a line. `pl-3` lines the text up with the input's own
 * text, which sits behind `px-3` and a border. Placing it in the row keeps
 * one element for both layouts, which is what `aria-describedby` wants.
 *
 * The syntax sentence lives here rather than in each caller because it is
 * one claim about one thing: every listing search goes through
 * `websearch_to_tsquery`, so a quoted phrase and a leading minus work on all
 * of them. `fields` is the part that differs, and it must be true of that
 * page's query in `src/server/_internal`.
 *
 * Text only, no link and no control: the row ends with the Filters button,
 * and the tab order from the search to it is asserted.
 *
 * `query` is optional and is the listing's committed query, never the input's
 * draft: a query past `SEARCH_QUERY_MAX` is cut on the server, and this line
 * is where the reader is told so (#478). In this paragraph rather than in one
 * of its own because the input already points at it through
 * `aria-describedby`, so the cut is announced on focus without a live region,
 * and because a second paragraph would need its own margin in four call
 * sites.
 */
export function SearchHint({
  fields,
  id,
  query,
}: {
  fields: string;
  id: string;
  query?: string;
}) {
  const note = query === undefined ? null : searchQueryNote(query);
  return (
    <p
      className="-mt-1 basis-full pl-3 text-muted-foreground text-xs md:order-last"
      id={id}
    >
      Searches {fields}. Quote a "phrase", or put - before a word to exclude it.
      {note && <span className="text-foreground"> {note}</span>}
    </p>
  );
}

/**
 * The same note under a bare search box: the three staff tables that have an
 * input and no `SearchHint` (`/admin/users`, `/admin/mentors` and the
 * inventory request queue) render this instead.
 *
 * It renders nothing when there is nothing to say, the way `FieldError` does
 * and for the reason UI-CONVENTIONS gives there: three hand-written
 * paragraphs are three margins to drift. It carries no width of its own,
 * because the three boxes are not the same width: each caller's toolbar cell
 * carries the width and the input fills it, so the sentence wraps to the box
 * it belongs to rather than widening the cell past it.
 *
 * The caller still calls `searchQueryNote` itself, for the conditional
 * `aria-describedby` on its input: a reference to a paragraph that is not
 * rendered is a broken one.
 */
export function SearchQueryNote({ id, query }: { id: string; query: string }) {
  const note = searchQueryNote(query);
  if (note === null) {
    return null;
  }
  return (
    <p className="mt-1 text-xs" id={id}>
      {note}
    </p>
  );
}

/**
 * What the reader is told when their query was longer than the server runs,
 * and `null` when it was not. One sentence, in one place: `SearchHint` puts
 * it in the line it already owns, and `SearchQueryNote` above renders it for
 * a box with no hint under it.
 *
 * It reads the same function the schemas clamp with, so the note cannot claim
 * a cut the query did not get, or stay silent about one it did.
 */
export function searchQueryNote(query: string): string | null {
  if (!clampSearchQuery(query).truncated) {
    return null;
  }
  return `Your search was too long, so only its first ${SEARCH_QUERY_MAX} characters were used.`;
}
