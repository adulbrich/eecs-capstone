import Papa from "papaparse";
import { z } from "zod";
import { cell, type ImportIssue, parseRows } from "#/lib/placement/csv";
import {
  type PlacementDataset,
  STANDARD_FORMATS,
  writeFormat,
} from "#/lib/placement/formats";
import type {
  ChosenPlugin,
  ColumnMapping,
  Conversion,
} from "#/lib/placement/plugins/types";

/**
 * Custom mapping (#735): a file read through a column mapping staff build on
 * the page. The column mapping is data, never code (ADR-0059): which header
 * of the file fills each standard column, one row in and one row out. The
 * roster and the bids store it beside the file, so it is read through on
 * every load and travels in the workspace export; projects run it once, at
 * import. It also downloads as a small JSON file, to load again for a file
 * of the same shape.
 */

export type { ColumnMapping } from "#/lib/placement/plugins/types";

/** The column mapping file's shape. A later shape gets a new number. */
export const MAPPING_VERSION = 1;

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

const columnMappingSchema = z
  .object({
    version: z.literal(MAPPING_VERSION),
    dataset: z.enum(DATASETS),
    columns: z.record(z.string(), z.string()),
  })
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
  if (typeof version === "number" && version !== MAPPING_VERSION) {
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

/** "The column mapping is version 2, and this page reads version 1." */
export const versionMessage = (version: number) =>
  `The column mapping is version ${version}, and this page reads version ${MAPPING_VERSION}.`;

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
    },
    null,
    2
  )}\n`;
}

const BOM = /^﻿/;

/**
 * The file's headers as it spells them, in its order, for the page to offer:
 * `parseRows` lowercases them, which would show "student email" for a file
 * that says "Student Email". Blank headers are left out.
 */
export function fileHeaders(text: string): string[] {
  const first =
    Papa.parse<string[]>(text.replace(BOM, ""), {
      preview: 1,
      skipEmptyLines: "greedy",
    }).data[0] ?? [];
  const seen = new Set<string>();
  return first
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
  return { version: MAPPING_VERSION, dataset, columns };
}

/**
 * The column mapping for `dataset`'s slot: only pairs that fill one of its
 * standard columns, the first header for each, stamped with `dataset`. What
 * a mapping from a stored workspace or a loaded file becomes before the page
 * edits it, so Apply can never store a mapping another format would read.
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
  return { version: MAPPING_VERSION, dataset, columns };
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
 * The pairs whose header the file has, spelled as the file spells it: what
 * Apply stores and the preview reads.
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
  return { ...mapping, columns };
}

/** The required standard columns no header fills yet, in format order. */
export function unmappedRequired(mapping: ColumnMapping): string[] {
  const filled = new Set(Object.values(mapping.columns));
  return STANDARD_FORMATS[mapping.dataset].columns
    .filter((c) => c.required && !filled.has(c.name))
    .map((c) => c.name);
}

/**
 * The headers the column mapping reads that the file lacks, as the mapping
 * spells them.
 */
export function missingHeaders(
  mapping: ColumnMapping,
  headers: readonly string[]
): string[] {
  const present = new Set(headers.map(normalizeHeader));
  return Object.keys(mapping.columns).filter(
    (h) => !present.has(normalizeHeader(h))
  );
}

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

/**
 * The file's rows as standard rows, one for one: each standard column takes
 * its header's cell, and one no header fills is blank. Nothing more is
 * checked here; the dataset's parser reads the result, as it reads a
 * standard file, and the page shows the first few rows as they come.
 */
export function mapRows(
  text: string,
  mapping: ColumnMapping
): {
  firstRecordRow: number;
  issues: ImportIssue[];
  rows: Record<string, string>[];
} {
  const { fields, firstRecordRow, issues, rows } = parseRows(text);
  if (issues.some((i) => i.wholeFile)) {
    return { firstRecordRow, issues, rows: [] };
  }
  const missing = missingHeaders(mapping, fields);
  if (missing.length > 0) {
    return {
      issues: missing.map((header) =>
        stopped(
          `The file has no "${header}" column, which the column mapping reads as ${mapping.columns[header]}.`
        )
      ),
      firstRecordRow,
      rows: [],
    };
  }
  const pairs = Object.entries(mapping.columns).map(
    ([header, column]) => [normalizeHeader(header), column] as const
  );
  return {
    firstRecordRow,
    issues,
    rows: rows.map((raw) =>
      Object.fromEntries(
        pairs.map(([header, column]) => [column, cell(raw, header)])
      )
    ),
  };
}

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
  const { firstRecordRow, issues, rows } = mapRows(text, mapping);
  // The file's blank lines before its header go first, so the parser names
  // each converted row by its row in the uploaded file.
  return {
    text: "\r\n".repeat(firstRecordRow - 2) + writeFormat(format, rows),
    issues,
  };
}

/** Custom mapping's id for `dataset`, as a workspace stores it in `readAs`. */
export const columnMappingId = (dataset: PlacementDataset) =>
  `custom-mapping-${dataset}`;

function customMapping(dataset: PlacementDataset): ChosenPlugin {
  return {
    id: columnMappingId(dataset),
    label: "column-mapped",
    menuLabel: "Column mapping",
    dataset,
    input: "chosen",
    description:
      "Read through your column mapping: each standard column takes the cell of the file column chosen for it, and an optional column left unmapped is blank. Each row of the file becomes one row of the converted CSV, in order, so the problems listed for the converted file follow your file's rows.",
    toStandard: (text, { mapping }) => convert(dataset, text, mapping),
  };
}

/** Custom mapping for each dataset. */
export const CUSTOM_MAPPINGS: Record<PlacementDataset, ChosenPlugin> = {
  projects: customMapping("projects"),
  roster: customMapping("roster"),
  bids: customMapping("bids"),
};
