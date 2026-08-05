import { describe, expect, it } from "vitest";
import { type CsvColumn, toCsv } from "#/lib/csv";

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
    expect(csv.split("\r\n")[1]).toMatch(/^"Bolt, hex",/);
  });

  it("doubles inner quotes and wraps the value", () => {
    const csv = toCsv(COLUMNS, [row({ name: 'The "Big" One' })]);
    expect(csv.split("\r\n")[1]).toMatch(/^"The ""Big"" One",/);
  });

  it("quotes values containing a newline", () => {
    const csv = toCsv(COLUMNS, [row({ name: "line one\nline two" })]);
    expect(csv).toContain('"line one\nline two"');
  });

  it.each([
    "=",
    "+",
    "-",
    "@",
    "\t",
    "\r",
  ])("prefixes a formula-injection lead character (%j) with an apostrophe", (lead) => {
    const csv = toCsv(
      [{ header: "Name", value: (r: Row) => r.name }],
      [row({ name: `${lead}HYPERLINK("http://evil")` })]
    );
    expect(csv.split("\r\n")[1]).toContain(`'${lead}HYPERLINK`);
  });

  it("puts the guard apostrophe inside the quotes when both apply", () => {
    const csv = toCsv(
      [{ header: "Name", value: (r: Row) => r.name }],
      [row({ name: "=SUM(A1,A2)" })]
    );
    expect(csv.split("\r\n")[1]).toBe(`"'=SUM(A1,A2)"`);
  });

  it("leaves a safe value untouched", () => {
    const csv = toCsv(
      [{ header: "Name", value: (r: Row) => r.name }],
      [row({ name: "Widget" })]
    );
    expect(csv.split("\r\n")[1]).toBe("Widget");
  });
});
