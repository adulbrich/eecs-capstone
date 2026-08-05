/**
 * A single CSV column. `header` is the text in the first row; `value` pulls
 * the cell out of a record and may return anything, including a Date, an
 * array, or null. Serialization is this module's job, not the caller's.
 */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

// Hoisted rather than built per cell: these run once per value in a file
// that may hold hundreds of rows times twenty columns.
const NEEDS_QUOTING = /["\r\n,]/;

/**
 * Leading characters a spreadsheet treats as the start of a formula. An item
 * name is user input, so without this guard an export of attacker-influenced
 * data executes when an admin opens it in Excel or Sheets.
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
