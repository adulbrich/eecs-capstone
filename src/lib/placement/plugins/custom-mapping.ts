import Papa from "papaparse";
import { z } from "zod";
import {
  cell,
  type ImportIssue,
  LEADING_BLANK_LINES,
  parseRows,
  type Row,
} from "#/lib/placement/csv";
import {
  type PlacementDataset,
  STANDARD_FORMATS,
  writeFormat,
} from "#/lib/placement/formats";
import {
  splitAtSeparator,
  titleInBrackets,
} from "#/lib/placement/plugins/header-title";
import type {
  ChosenPlugin,
  ColumnMapping,
  Conversion,
  WideBids,
} from "#/lib/placement/plugins/types";

/**
 * Custom mapping (#735): a file read through a column mapping staff build on
 * the page. The column mapping is data, never code (ADR-0059): which header
 * of the file fills each standard column, one row in and one row out. The
 * roster and the bids store it beside the file, so it is read through on
 * every load and travels in the workspace export; projects run it once, at
 * import. It also downloads as a small JSON file, to load again for a file
 * of the same shape.
 *
 * A bids column mapping may also read the file wide (#736): one row per
 * student and one column per project, each filled cell becoming one bid
 * titled from its column's header, with the student's columns repeated on
 * every bid. The parser checks the priorities, as it checks any bid's.
 */

export type { ColumnMapping, WideBids } from "#/lib/placement/plugins/types";

/**
 * The latest column mapping shape this page reads: version 2 adds wide
 * reading, and version 1 is read as it always was.
 */
export const MAPPING_VERSION = 2;

/** A header as `parseRows` keys it. */
export const normalizeHeader = (header: string) => header.trim().toLowerCase();

/** Names as the page lists them: "email", "name". */
export const quoted = (names: readonly string[]) =>
  names.map((n) => `"${n}"`).join(", ");

const DATASETS = [
  "projects",
  "roster",
  "bids",
] as const satisfies readonly PlacementDataset[];

/** The bids columns a header fills in wide reading: who the student is. */
export const STUDENT_COLUMNS: readonly string[] = ["email", "name", "avoid"];

/**
 * The columns the project columns fill in wide reading: a cell's value is
 * the priority, and its header's title the project.
 */
const PROJECT_FILLED: readonly string[] = ["priority", "project"];

/**
 * A column mapping with the version its shape needs: 2 with wide reading,
 * 1 without, so a column mapping that does not read wide still loads on a
 * page that reads version 1 alone.
 */
export function columnMapping(
  dataset: PlacementDataset,
  columns: Record<string, string>,
  wide?: WideBids
): ColumnMapping {
  return wide === undefined
    ? { version: 1, dataset, columns }
    : { version: 2, dataset, columns, wide };
}

/** Each student column's header, by its key, with the column it fills. */
const studentColumnsByKey = (mapping: ColumnMapping) =>
  new Map(
    Object.entries(mapping.columns).map(([header, column]) => [
      normalizeHeader(header),
      column,
    ])
  );

/**
 * What is wrong with a column mapping's wide reading, before any file is
 * read, as phrases: what the schema refuses and conversion stops on.
 */
export function wideProblems(mapping: ColumnMapping): string[] {
  const { wide } = mapping;
  if (wide === undefined) {
    return [];
  }
  if (mapping.dataset !== "bids") {
    return ["one column per project is for the bids only"];
  }
  const problems = Object.values(mapping.columns)
    .filter((column) => !STUDENT_COLUMNS.includes(column))
    .map(
      (column) =>
        `with one column per project, a header fills only email, name or avoid, not ${column}`
    );
  const set = wide.projectColumns;
  if (set.by === "prefix" && set.prefix.trim() === "") {
    problems.push("the project columns' header start is blank");
  }
  if (set.by === "headers") {
    if (set.headers.length === 0) {
      problems.push("no column is chosen as a project column");
    }
    const students = studentColumnsByKey(mapping);
    const seen = new Set<string>();
    for (const header of set.headers) {
      const key = normalizeHeader(header);
      const student = students.get(key);
      if (key === "") {
        problems.push("a project column's header is blank");
      } else if (seen.has(key)) {
        problems.push(`the project column "${header}" is listed twice`);
      } else if (student !== undefined) {
        problems.push(
          `the header "${header}" is the ${student} column and a project column`
        );
      }
      seen.add(key);
    }
  }
  if (wide.title.by === "separator" && wide.title.separator === "") {
    problems.push("the title separator is blank");
  }
  return problems;
}

const wideSchema = z.object({
  projectColumns: z.discriminatedUnion("by", [
    z.object({ by: z.literal("prefix"), prefix: z.string() }),
    z.object({ by: z.literal("headers"), headers: z.array(z.string()) }),
  ]),
  title: z.discriminatedUnion("by", [
    z.object({ by: z.literal("separator"), separator: z.string() }),
    z.object({ by: z.literal("brackets") }),
  ]),
});

const mappingFields = {
  dataset: z.enum(DATASETS),
  columns: z.record(z.string(), z.string()),
};

// Version 1 has no wide reading, so a `wide` key in a version 1 file is
// dropped, as any key the shape lacks always was.
const columnMappingSchema = z
  .discriminatedUnion("version", [
    z.object({ version: z.literal(1), ...mappingFields }),
    z.object({
      version: z.literal(2),
      ...mappingFields,
      wide: wideSchema.optional(),
    }),
  ])
  .superRefine((mapping, ctx) => {
    const known = new Set(
      STANDARD_FORMATS[mapping.dataset].columns.map((c) => c.name)
    );
    const filled = new Set<string>();
    const headers = new Set<string>();
    for (const [header, column] of Object.entries(mapping.columns)) {
      const key = normalizeHeader(header);
      if (key === "") {
        ctx.addIssue({ code: "custom", message: "a header is blank" });
      } else if (headers.has(key)) {
        ctx.addIssue({
          code: "custom",
          message: `the header "${header}" is listed twice`,
        });
      }
      headers.add(key);
      if (!known.has(column)) {
        ctx.addIssue({
          code: "custom",
          message: `${column} is not a column of the ${mapping.dataset} format`,
        });
      } else if (filled.has(column)) {
        ctx.addIssue({
          code: "custom",
          message: `more than one header fills ${column}`,
        });
      }
      filled.add(column);
    }
    for (const message of wideProblems(mapping)) {
      ctx.addIssue({ code: "custom", message });
    }
  });

/**
 * A column mapping from parsed JSON, or why it is not one: a version this
 * page does not read, or the first problem with its shape.
 */
export function readMapping(
  value: unknown
):
  | { ok: true; mapping: ColumnMapping }
  | { ok: false; version: number }
  | { ok: false; problem: string } {
  const version = (value as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version !== 1 && version !== 2) {
    return { ok: false, version };
  }
  const parsed = columnMappingSchema.safeParse(value);
  return parsed.success
    ? { ok: true, mapping: parsed.data }
    : {
        ok: false,
        problem: parsed.error.issues[0]?.message ?? "unknown problem",
      };
}

/** "The column mapping is version 3, and this page reads version 2 and earlier." */
export const versionMessage = (version: number) =>
  `The column mapping is version ${version}, and this page reads version ${MAPPING_VERSION} and earlier.`;

/** A downloaded column mapping file, or why it is not one this page reads. */
export function parseMapping(
  json: string
): { ok: true; mapping: ColumnMapping } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, message: "The file is not JSON." };
  }
  const read = readMapping(value);
  if (read.ok) {
    return read;
  }
  return {
    ok: false,
    message:
      "version" in read
        ? versionMessage(read.version)
        : `The file is not a column mapping: ${read.problem}.`,
  };
}

/** The column mapping as the file "Download column mapping" saves. */
export function serializeMapping(mapping: ColumnMapping): string {
  return `${JSON.stringify(
    {
      version: mapping.version,
      dataset: mapping.dataset,
      columns: mapping.columns,
      ...(mapping.wide === undefined ? {} : { wide: mapping.wide }),
    },
    null,
    2
  )}\n`;
}

/**
 * The header row's cells as the file spells them, blanks included, so a
 * cell's index is its column. Blank lines and a byte order mark before the
 * header are skipped, as `parseRows` skips them.
 */
function headerCells(text: string): string[] {
  return (
    Papa.parse<string[]>(text.replace(LEADING_BLANK_LINES, ""), {
      preview: 1,
      skipEmptyLines: "greedy",
    }).data[0] ?? []
  );
}

/**
 * The file's headers as it spells them, in its order, for the page to offer:
 * `parseRows` lowercases them, which would show "student email" for a file
 * that says "Student Email". Blank headers are left out.
 */
export function fileHeaders(text: string): string[] {
  const seen = new Set<string>();
  return headerCells(text)
    .map((h) => h.trim())
    .filter((h) => {
      const key = normalizeHeader(h);
      if (key === "" || seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

/**
 * Each standard column a header already names, ignoring case: what the
 * page offers before staff choose anything.
 */
export function suggestMapping(
  dataset: PlacementDataset,
  headers: readonly string[]
): ColumnMapping {
  const columns: Record<string, string> = {};
  for (const { name } of STANDARD_FORMATS[dataset].columns) {
    const header = headers.find((h) => normalizeHeader(h) === name);
    if (header !== undefined) {
      columns[header] = name;
    }
  }
  return columnMapping(dataset, columns);
}

/**
 * The column mapping for `dataset`'s slot: only pairs that fill one of its
 * standard columns, the first header for each, stamped with `dataset`, and
 * wide reading only for the bids. What a mapping from a stored workspace or
 * a loaded file becomes before the page edits it, so Apply can never store
 * a mapping another format would read.
 */
export function fitToDataset(
  mapping: ColumnMapping,
  dataset: PlacementDataset
): ColumnMapping {
  const known = new Set(STANDARD_FORMATS[dataset].columns.map((c) => c.name));
  const filled = new Set<string>();
  const columns: Record<string, string> = {};
  for (const [header, column] of Object.entries(mapping.columns)) {
    if (known.has(column) && !filled.has(column)) {
      filled.add(column);
      columns[header] = column;
    }
  }
  return columnMapping(
    dataset,
    columns,
    dataset === "bids" ? mapping.wide : undefined
  );
}

/**
 * The pairs `fitToDataset` leaves out, as '"Rank" (priority)': a column the
 * dataset's format lacks, or a second header for one column.
 */
export function droppedColumns(
  mapping: ColumnMapping,
  dataset: PlacementDataset
): string[] {
  const kept = fitToDataset(mapping, dataset).columns;
  return Object.entries(mapping.columns)
    .filter(([header]) => !Object.hasOwn(kept, header))
    .map(([header, column]) => `"${header}" (${column})`);
}

/**
 * The pairs, and the picked project columns, whose header the file has,
 * spelled as the file spells it: what Apply stores and the preview reads.
 */
export function presentIn(
  mapping: ColumnMapping,
  headers: readonly string[]
): ColumnMapping {
  const byKey = new Map(headers.map((h) => [normalizeHeader(h), h]));
  const columns: Record<string, string> = {};
  for (const [header, column] of Object.entries(mapping.columns)) {
    const own = byKey.get(normalizeHeader(header));
    if (own !== undefined) {
      columns[own] = column;
    }
  }
  const { wide } = mapping;
  if (wide?.projectColumns.by !== "headers") {
    return { ...mapping, columns };
  }
  const picked = wide.projectColumns.headers.flatMap((h) => {
    const own = byKey.get(normalizeHeader(h));
    return own === undefined ? [] : [own];
  });
  return {
    ...mapping,
    columns,
    wide: { ...wide, projectColumns: { by: "headers", headers: picked } },
  };
}

/**
 * The required standard columns no header fills yet, in format order. In
 * wide reading the project columns fill the priority and the project.
 */
export function unmappedRequired(mapping: ColumnMapping): string[] {
  const filled = new Set(Object.values(mapping.columns));
  const fromProjects = mapping.wide === undefined ? [] : PROJECT_FILLED;
  return STANDARD_FORMATS[mapping.dataset].columns
    .filter(
      (c) => c.required && !filled.has(c.name) && !fromProjects.includes(c.name)
    )
    .map((c) => c.name);
}

/** The picked project columns' headers, or none for a prefix. */
const pickedHeaders = (mapping: ColumnMapping) =>
  mapping.wide?.projectColumns.by === "headers"
    ? mapping.wide.projectColumns.headers
    : [];

/**
 * The headers the column mapping reads that the file lacks, as the mapping
 * spells them: the student columns' first, then the picked project columns'.
 */
export function missingHeaders(
  mapping: ColumnMapping,
  headers: readonly string[]
): string[] {
  const present = new Set(headers.map(normalizeHeader));
  return [...Object.keys(mapping.columns), ...pickedHeaders(mapping)].filter(
    (h) => !present.has(normalizeHeader(h))
  );
}

/** What the column mapping reads a header as: "email", "a project column". */
export const readsAs = (mapping: ColumnMapping, header: string) =>
  mapping.columns[header] ?? "a project column";

/** Each standard column more than one header fills, with those headers. */
function filledTwice(mapping: ColumnMapping): [string, string[]][] {
  const byColumn = new Map<string, string[]>();
  for (const [header, column] of Object.entries(mapping.columns)) {
    byColumn.set(column, [...(byColumn.get(column) ?? []), header]);
  }
  return [...byColumn].filter(([, headers]) => headers.length > 1);
}

const stopped = (message: string): ImportIssue => ({
  level: "error",
  row: 1,
  message,
  wholeFile: true,
});

/** A column as a spreadsheet names it: 0 is "A", 26 is "AA". */
export function columnLetter(index: number): string {
  let letters = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  }
  return letters;
}

/** A project column's title as its header holds it; "" when it has none. */
function titleOf(header: string, title: WideBids["title"]): string {
  return (
    (title.by === "brackets"
      ? titleInBrackets(header)
      : splitAtSeparator(header, title.separator)?.title) ?? ""
  );
}

/** Where the title is looked for, for a message: 'after " - "'. */
const titlePlace = (title: WideBids["title"]) =>
  title.by === "brackets"
    ? "inside square brackets"
    : `after "${title.separator}"`;

/** A project column, by the key `parseRows` reads it under, and its title. */
interface ProjectColumn {
  key: string;
  title: string;
}

/**
 * The file's project columns, in its order, with the title each header
 * gives; or, as sentences, why the file cannot be read wide: a project
 * column that is also a student column or gives no title, or no project
 * column at all.
 */
function projectColumns(
  text: string,
  mapping: ColumnMapping,
  wide: WideBids
): { columns: ProjectColumn[] } | { problems: string[] } {
  const set = wide.projectColumns;
  const picked = new Set(pickedHeaders(mapping).map(normalizeHeader));
  const prefix = set.by === "prefix" ? normalizeHeader(set.prefix) : "";
  const inSet = (key: string) =>
    set.by === "prefix" ? key.startsWith(prefix) : picked.has(key);
  const students = studentColumnsByKey(mapping);
  const found: ProjectColumn[] = [];
  const problems: string[] = [];
  headerCells(text).forEach((raw, index) => {
    const header = raw.trim();
    const key = normalizeHeader(header);
    if (key === "" || !inSet(key)) {
      return;
    }
    const named = `Column ${columnLetter(index)}, "${header}",`;
    const student = students.get(key);
    const title = titleOf(header, wide.title);
    if (student !== undefined) {
      problems.push(
        `${named} is the ${student} column and a project column; choose one.`
      );
    } else if (title === "") {
      problems.push(
        `${named} is a project column, but its header has no title ${titlePlace(wide.title)}.`
      );
    } else {
      found.push({ key, title });
    }
  });
  if (problems.length > 0) {
    return { problems };
  }
  if (found.length === 0) {
    return {
      problems: [
        set.by === "prefix"
          ? `No column's header starts with "${set.prefix.trim()}".`
          : "Choose the project columns.",
      ],
    };
  }
  return { columns: found };
}

/**
 * Each record row as its bids: one per project column with a priority,
 * the student's columns repeated on each. A row with none gives none, and
 * says so in the file's own row.
 */
function wideRows(
  rows: Row[],
  firstRecordRow: number,
  mapping: ColumnMapping,
  projects: readonly ProjectColumn[]
): { issues: ImportIssue[]; rows: Record<string, string>[] } {
  const student = Object.entries(mapping.columns).map(
    ([header, column]) => [normalizeHeader(header), column] as const
  );
  const issues: ImportIssue[] = [];
  const bids: Record<string, string>[] = [];
  rows.forEach((raw, index) => {
    const who = Object.fromEntries(
      student.map(([header, column]) => [column, cell(raw, header)])
    );
    const own = projects
      .map(({ key, title }) => ({
        ...who,
        priority: cell(raw, key),
        project: title,
      }))
      .filter((bid) => bid.priority !== "");
    if (own.length === 0) {
      issues.push({
        level: "warning",
        row: firstRecordRow + index,
        message:
          "The row has no priority in any project column, so it gives no bids.",
      });
    }
    bids.push(...own);
  });
  return { issues, rows: bids };
}

/**
 * The file's rows as standard rows: one for one, each standard column taking
 * its header's cell and one no header fills left blank; or, read wide, one
 * per filled project cell. Nothing more is checked here; the dataset's
 * parser reads the result, as it reads a standard file, and the page shows
 * the first few rows as they come. `problems` says why the column mapping
 * cannot read this file wide, as sentences, with no rows.
 */
export function mapRows(
  text: string,
  mapping: ColumnMapping
): {
  firstRecordRow: number;
  issues: ImportIssue[];
  problems: string[];
  rows: Record<string, string>[];
} {
  const { fields, firstRecordRow, issues, rows } = parseRows(text);
  if (issues.some((i) => i.wholeFile)) {
    return { firstRecordRow, issues, problems: [], rows: [] };
  }
  const missing = missingHeaders(mapping, fields);
  if (missing.length > 0) {
    return {
      issues: missing.map((header) =>
        stopped(
          `The file has no "${header}" column, which the column mapping reads as ${readsAs(mapping, header)}.`
        )
      ),
      firstRecordRow,
      problems: [],
      rows: [],
    };
  }
  if (mapping.wide !== undefined) {
    const projects = projectColumns(text, mapping, mapping.wide);
    if ("problems" in projects) {
      return { firstRecordRow, issues, problems: projects.problems, rows: [] };
    }
    const read = wideRows(rows, firstRecordRow, mapping, projects.columns);
    return {
      firstRecordRow,
      issues: [...issues, ...read.issues],
      problems: [],
      rows: read.rows,
    };
  }
  const pairs = Object.entries(mapping.columns).map(
    ([header, column]) => [normalizeHeader(header), column] as const
  );
  return {
    firstRecordRow,
    issues,
    problems: [],
    rows: rows.map((raw) =>
      Object.fromEntries(
        pairs.map(([header, column]) => [column, cell(raw, header)])
      )
    ),
  };
}

/** "with one column per project, ..." as a sentence. */
const sentence = (phrase: string) =>
  `${phrase.charAt(0).toUpperCase()}${phrase.slice(1)}.`;

function convert(
  dataset: PlacementDataset,
  text: string,
  mapping: ColumnMapping | undefined
): Conversion {
  const format = STANDARD_FORMATS[dataset];
  const stop = (...messages: string[]): Conversion => ({
    text: writeFormat(format, []),
    issues: messages.map(stopped),
  });
  if (mapping === undefined) {
    return stop(
      "No column mapping is saved for this file. Choose Map columns to make one."
    );
  }
  if (mapping.dataset !== dataset) {
    return stop(
      `The column mapping is for the ${mapping.dataset}, not the ${dataset}.`
    );
  }
  const wrong = wideProblems(mapping);
  if (wrong.length > 0) {
    return stop(...wrong.map(sentence));
  }
  // One header per column, as the schema has it: otherwise the last header
  // would fill the column and the others vanish without a word.
  const twice = filledTwice(mapping);
  if (twice.length > 0) {
    return stop(
      ...twice.map(
        ([column, headers]) =>
          `The column mapping fills ${column} from ${quoted(headers)}; choose one.`
      )
    );
  }
  const unmapped = unmappedRequired(mapping);
  if (unmapped.length > 0) {
    return stop(
      `The column mapping leaves ${quoted(unmapped)} unmapped, which the ${dataset} format requires.`
    );
  }
  const { firstRecordRow, issues, problems, rows } = mapRows(text, mapping);
  if (problems.length > 0) {
    return stop(...problems);
  }
  // The file's blank lines before its header go first, so the parser names
  // each converted row by its row in the uploaded file. Read wide, a file
  // row gives several, so the parser names the converted file's rows.
  const lead = mapping.wide === undefined ? firstRecordRow - 2 : 0;
  return {
    text: "\r\n".repeat(lead) + writeFormat(format, rows),
    issues,
  };
}

/** Custom mapping's id for `dataset`, as a workspace stores it in `readAs`. */
export const columnMappingId = (dataset: PlacementDataset) =>
  `custom-mapping-${dataset}`;

const DESCRIPTION =
  "Read through your column mapping: each standard column takes the cell of the file column chosen for it, and an optional column left unmapped is blank. Each row of the file becomes one row of the converted CSV, in order, so the problems listed for the converted file follow your file's rows.";

/** What changes for a bids file read with one column per project. */
const WIDE_DESCRIPTION =
  " A bids file read with one column per project instead gives one bid for each filled cell, so the problems listed for the converted file name rows of the converted CSV, which you can download.";

function customMapping(dataset: PlacementDataset): ChosenPlugin {
  return {
    id: columnMappingId(dataset),
    label: "column-mapped",
    menuLabel: "Column mapping",
    dataset,
    input: "chosen",
    description:
      dataset === "bids" ? `${DESCRIPTION}${WIDE_DESCRIPTION}` : DESCRIPTION,
    toStandard: (text, { mapping }) => convert(dataset, text, mapping),
  };
}

/** Custom mapping for each dataset. */
export const CUSTOM_MAPPINGS: Record<PlacementDataset, ChosenPlugin> = {
  projects: customMapping("projects"),
  roster: customMapping("roster"),
  bids: customMapping("bids"),
};
