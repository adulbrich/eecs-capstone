import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { type CsvColumn, toCsv, unguardCell } from "#/lib/csv";
import { trickyText } from "#/test/shared/arbitraries";

interface Row {
  active: boolean;
  count: number | null;
  name: string;
  tags: string[];
  when: Date | null;
}

const COLUMNS: CsvColumn<Row>[] = [
  { header: "Name", value: (r) => r.name },
  { header: "Count", value: (r) => r.count },
  { header: "Active", value: (r) => r.active },
  { header: "When", value: (r) => r.when },
  { header: "Tags", value: (r) => r.tags },
];

function row(overrides: Partial<Row> = {}): Row {
  return {
    name: "Widget",
    count: 3,
    active: true,
    when: new Date("2026-08-05T12:00:00.000Z"),
    tags: ["a", "b"],
    ...overrides,
  };
}

describe("toCsv", () => {
  it("writes a header row from the column headers", () => {
    expect(toCsv(COLUMNS, []).split("\r\n")[0]).toBe(
      "Name,Count,Active,When,Tags"
    );
  });

  it("yields a header-only file for an empty row set", () => {
    expect(toCsv(COLUMNS, [])).toBe("Name,Count,Active,When,Tags");
  });

  it("terminates rows with CRLF per RFC 4180", () => {
    const csv = toCsv(COLUMNS, [row(), row()]);
    expect(csv.split("\r\n")).toHaveLength(3);
  });

  it("renders dates as ISO 8601", () => {
    const csv = toCsv(COLUMNS, [row()]);
    expect(csv.split("\r\n")[1]).toContain("2026-08-05T12:00:00.000Z");
  });

  it("renders nulls as empty", () => {
    const csv = toCsv(COLUMNS, [row({ count: null, when: null })]);
    expect(csv.split("\r\n")[1]).toBe("Widget,,true,,a; b");
  });

  it("joins arrays with a semicolon and a space", () => {
    const csv = toCsv(COLUMNS, [row({ tags: ["x", "y", "z"] })]);
    expect(csv.split("\r\n")[1]).toContain("x; y; z");
  });

  it("quotes values containing a comma", () => {
    const csv = toCsv(COLUMNS, [row({ name: "Bolt, hex" })]);
    expect(csv.split("\r\n")[1]).toMatch(/^"Bolt, hex",/u);
  });

  it("doubles inner quotes and wraps the value", () => {
    const csv = toCsv(COLUMNS, [row({ name: 'The "Big" One' })]);
    expect(csv.split("\r\n")[1]).toMatch(/^"The ""Big"" One",/u);
  });

  it("quotes values containing a newline", () => {
    const csv = toCsv(COLUMNS, [row({ name: "line one\nline two" })]);
    expect(csv).toContain('"line one\nline two"');
  });

  it.each(["=", "+", "-", "@", "\t", "\r"])(
    "prefixes a formula-injection lead character (%j) with an apostrophe",
    (lead) => {
      const csv = toCsv(
        [{ header: "Name", value: (r: Row) => r.name }],
        [row({ name: `${lead}HYPERLINK("http://evil")` })]
      );
      expect(csv.split("\r\n")[1]).toContain(`'${lead}HYPERLINK`);
    }
  );

  it("puts the guard apostrophe inside the quotes when both apply", () => {
    const csv = toCsv(
      [{ header: "Name", value: (r: Row) => r.name }],
      [row({ name: "=SUM(A1,A2)" })]
    );
    expect(csv.split("\r\n")[1]).toBe(`"'=SUM(A1,A2)"`);
  });

  it("guards a value that already looks guarded, so reading it back is exact", () => {
    const names = ["'-Minus", "'=cmd", "'apostrophe", "-dash"];
    const csv = toCsv(
      [{ header: "Name", value: (r: Row) => r.name }],
      names.map((name) => row({ name }))
    );
    const cells = csv.split("\r\n").slice(1);
    expect(cells).toEqual(["''-Minus", "''=cmd", "'apostrophe", "'-dash"]);
    expect(cells.map(unguardCell)).toEqual(names);
  });

  it("leaves a safe value untouched", () => {
    const csv = toCsv(
      [{ header: "Name", value: (r: Row) => r.name }],
      [row({ name: "Widget" })]
    );
    expect(csv.split("\r\n")[1]).toBe("Widget");
  });
});

/**
 * One field of RFC 4180 text from `start`: its value and where it ended.
 * Strict where the RFC is, so a quoting slip in `toCsv` throws rather than
 * reading back as some other cell: a quote opens a field only at its start,
 * and an unquoted field may hold no quote, CR or LF.
 */
function readField(text: string, start: number): [string, number] {
  let i = start;
  let value = "";
  if (text[i] === '"') {
    i++;
    while (!(text[i] === '"' && text[i + 1] !== '"')) {
      if (i >= text.length) {
        throw new Error("a quoted field never closes");
      }
      value += text[i] === '"' ? '"' : (text[i] as string);
      i += text[i] === '"' ? 2 : 1;
    }
    return [value, i + 1];
  }
  while (i < text.length && text[i] !== "," && text[i] !== "\r") {
    if (text[i] === '"' || text[i] === "\n") {
      throw new Error(`an unquoted ${JSON.stringify(text[i])} at ${i}`);
    }
    value += text[i];
    i++;
  }
  return [value, i];
}

/** RFC 4180 text as records, each field ending at a comma, CRLF or the end. */
function readCsv(text: string): string[][] {
  const records: string[][] = [[]];
  let i = 0;
  for (;;) {
    const [value, end] = readField(text, i);
    records.at(-1)?.push(value);
    if (end >= text.length) {
      return records;
    }
    if (text[end] === ",") {
      i = end + 1;
    } else if (text.startsWith("\r\n", end)) {
      records.push([]);
      i = end + 2;
    } else {
      throw new Error(`${JSON.stringify(text[end])} after a field at ${end}`);
    }
  }
}

/** A spreadsheet's formula lead-ins, which a cell must never start with. */
const FORMULA_LEAD = /^[=+\-@\t\r]/u;

/** Tricky text, or tricky text behind a formula lead-in or a guard-like `'`. */
const cellText = fc.oneof(
  trickyText(),
  fc
    .tuple(fc.constantFrom("=", "+", "-", "@", "\t", "\r", "'"), trickyText())
    .map(([lead, rest]) => lead + rest)
);

/** A header row and up to five rows of the same width. */
const sameWidthTable = fc.integer({ max: 5, min: 1 }).chain((width) =>
  fc.tuple(
    fc.array(cellText, { maxLength: width, minLength: width }),
    fc.array(fc.array(cellText, { maxLength: width, minLength: width }), {
      maxLength: 5,
    })
  )
);

describe("toCsv, on generated tables", () => {
  test.prop([sameWidthTable])(
    "reads back through RFC 4180 and unguardCell to every cell, with no formula lead left live",
    ([headers, rows]) => {
      const columns: CsvColumn<string[]>[] = headers.map((header, i) => ({
        header,
        value: (record) => record[i],
      }));
      const parsed = readCsv(toCsv(columns, rows));
      expect(parsed.map((record) => record.map(unguardCell))).toEqual([
        headers,
        ...rows,
      ]);
      for (const field of parsed.flat()) {
        expect(field).not.toMatch(FORMULA_LEAD);
      }
    }
  );
});
