/**
 * The line under a listing's search row: what the box searches and the
 * syntax it takes. The input names it through `aria-describedby`, so a
 * screen reader hears it on focus, and it stays on the page at every width
 * and after the reader types, which a placeholder does not (#369, and
 * UI-CONVENTIONS "A placeholder is not a label").
 *
 * The syntax sentence lives here rather than in each caller because it is
 * one claim about one thing: every listing search goes through
 * `websearch_to_tsquery`, so a quoted phrase and a leading minus work on all
 * of them. `fields` is the part that differs, and it must be true of that
 * page's query in `src/server/_internal`.
 *
 * Text only, no link and no control: the row above ends with the Filters
 * button, and the tab order from the search to it is asserted.
 */
export function SearchHint({ fields, id }: { fields: string; id: string }) {
  return (
    <p className="mt-2 text-muted-foreground text-xs" id={id}>
      Searches {fields}. Quote a "phrase", or put - before a word to exclude it.
    </p>
  );
}
