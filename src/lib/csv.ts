/**
 * A single CSV column. `header` is the text in the first row; `value` pulls
 * the cell out of a record and may return anything, including a Date, an
 * array, or null. Serialization is this module's job, not the caller's.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * A `CsvColumn` that also records the key of the field it reads. `toCsv`
 * never looks at `key` itself; only `value` matters for serialization. It
 * exists purely so `ExhaustiveCsvColumns` can check, at the type level, that
 * a column list covers every field of `T`. Plain `CsvColumn` stays
 * untyped-per-key, for callers that don't need that guarantee.
 */
export interface KeyedCsvColumn<T> extends CsvColumn<T> {
  key: keyof T;
}

/**
 * Resolves to `C` when every key of `T` is covered by some column's `key`,
 * and to a descriptive error object otherwise. A `KeyedCsvColumn<T>[]`
 * literal assigned through `defineCsvColumns` therefore fails to compile
 * with a message naming the field it is missing a column for, rather than
 * silently building a CSV that omits it.
 */
export type ExhaustiveCsvColumns<T, C extends readonly KeyedCsvColumn<T>[]> = [
  Exclude<keyof T, C[number]["key"]>,
] extends [never]
  ? C
  : { MISSING_CSV_COLUMN_FOR: Exclude<keyof T, C[number]["key"]> };

/**
 * Builds an exhaustiveness-checked column list for one export projection.
 * Curried so `T` (the projection's row type) can be given explicitly at the
 * call site while `C` -- and therefore each column's literal `key` -- is
 * still inferred from the array literal passed in. Call as
 * `defineCsvColumns<Row>()([...])`.
 *
 * This is what makes "every selected field gets exactly one CSV column" a
 * build error instead of a comment: adding a field to a projection without
 * adding its column now fails `npm run typecheck`. Removing a field already
 * failed the build on its own, because the column's `value` would no longer
 * type-check against the narrowed row.
 */
export function defineCsvColumns<T>() {
  return <const C extends readonly KeyedCsvColumn<T>[]>(
    columns: ExhaustiveCsvColumns<T, C>
  ): CsvColumn<T>[] => columns as unknown as CsvColumn<T>[];
}

// Hoisted rather than built per cell: these run once per value in a file
// that may hold hundreds of rows times twenty columns.
const NEEDS_QUOTING = /["\r\n,]/;

/**
 * Leading characters a spreadsheet treats as the start of a formula. An item
 * name is user input, so without this guard an export of attacker-influenced
 * data executes when an admin opens it in Excel or Sheets.
 *
 * This is a deliberate fidelity/safety tradeoff, not a bug: the guard is
 * anchored to the very first character, so it only ever fires on a value
 * that a spreadsheet would itself treat as a formula lead-in. Its cost falls
 * on ordinary text that happens to start the same way -- most plausibly a
 * markdown bullet ("- like this") at the start of a project's description,
 * objectives, or notes. That value comes back from the export as `'- like
 * this`: an apostrophe Excel and Sheets hide from the user (their formula
 * bar shows the text unprefixed) but that a non-spreadsheet consumer, such
 * as `pandas.read_csv` or Python's `csv.reader`, sees as a literal leading
 * character that was never in the data.
 *
 * The tradeoff is accepted rather than narrowed because nothing in this app
 * re-imports its own CSV exports: there is no round-trip for the extra
 * apostrophe to corrupt, only a cosmetic wrinkle for a reader who opens the
 * file outside a spreadsheet. Weighed against an admin opening a project
 * export in Excel and having a formula execute from data another user
 * typed, the guard stays unconditional for every listed lead character,
 * `-` included.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

function serialize(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serialize).join("; ");
  }
  return String(value);
}

function escapeCell(value: unknown): string {
  const text = serialize(value);
  // The guard goes on before the quoting, so the apostrophe ends up inside
  // the quotes where the spreadsheet will see it.
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text;
  if (!NEEDS_QUOTING.test(guarded)) {
    return guarded;
  }
  return `"${guarded.replaceAll('"', '""')}"`;
}

/**
 * Serializes rows to RFC 4180 CSV text.
 *
 * Deliberately emits no UTF-8 BOM. The BOM is a consumer concern (Excel needs
 * it to avoid reading the file in the system codepage), not a property of the
 * CSV, and including it here would make every test assert against an
 * invisible character. `ExportCsvButton` prepends it at download time.
 */
export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((column) => escapeCell(column.header)).join(",");
  const body = rows.map((row) =>
    columns.map((column) => escapeCell(column.value(row))).join(",")
  );
  return [header, ...body].join("\r\n");
}

/**
 * Orders `rows` to match a sequence of ids -- the ids `AdminDataTable`
 * reports from its own sorted row model, via `onSortedIdsChange`. This is
 * what lets a CSV export's row order match the table on screen without a
 * route hand-copying the table's sort comparators (the default locale-aware
 * one, a column's `sortingFn: "datetime"`, or a custom status order):
 * whatever order the table actually rendered is, by construction, the order
 * this function reproduces.
 *
 * Any row whose id is not in `ids` keeps its existing relative order at the
 * end. In practice this should be empty -- every rendered row's id comes
 * from the same `rows` the caller passes here -- but a stale id sequence
 * (for instance, an export firing before the table's effect has run) must
 * degrade to "keep going," not to silently dropping rows.
 */
export function orderBySortedIds<T>(
  rows: readonly T[],
  ids: readonly string[],
  getId: (row: T) => string
): T[] {
  const byId = new Map(rows.map((row) => [getId(row), row] as const));
  const ordered: T[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (row !== undefined) {
      ordered.push(row);
      byId.delete(id);
    }
  }
  for (const row of rows) {
    if (byId.has(getId(row))) {
      ordered.push(row);
    }
  }
  return ordered;
}
