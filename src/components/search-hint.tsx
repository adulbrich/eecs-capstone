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
 */
export function SearchHint({ fields, id }: { fields: string; id: string }) {
  return (
    <p
      className="-mt-1 basis-full pl-3 text-muted-foreground text-xs md:order-last"
      id={id}
    >
      Searches {fields}. Quote a "phrase", or put - before a word to exclude it.
    </p>
  );
}
