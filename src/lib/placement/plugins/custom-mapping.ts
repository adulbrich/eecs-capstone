import Papa from "papaparse";
import { z } from "zod";
import { cell, type ImportIssue, parseRows } from "#/lib/placement/csv";
import {
  type PlacementDataset,
  STANDARD_FORMATS,
  writeFormat,
} from "#/lib/placement/formats";
import type { Conversion, FilePlugin } from "#/lib/placement/plugins/types";

/**
 * Custom mapping (#735): a file no plugin recognizes, read through a column
 * mapping staff build on the page. The mapping is data, never code
 * (ADR-0059): which header of the file fills each standard column, one row
 * in and one row out. The roster and the bids store it beside the file, so
 * it is read through on every load and travels in the workspace export;
 * projects run it once, at import. It also downloads as a small JSON file,
 * to load again for a file of the same shape.
 */

export const CUSTOM_MAPPING_ID = "custom-mapping";

/** The mapping file's shape. A later shape gets a new number. */
export const MAPPING_VERSION = 1;

export interface ColumnMapping {
  /**
   * Each header the mapping reads, as the file spells it, and the standard
   * column it fills. Header case and spaces around it are ignored, as the
   * standard format ignores them.
   */
  columns: Record<string, string>;
  dataset: PlacementDataset;
  version: typeof MAPPING_VERSION;
}

/** A header as `parseRows` keys it. */
export const normalizeHeader = (header: string) => header.trim().toLowerCase();

const DATASETS = [
  "projects",
  "roster",
  "bids",
] as const satisfies readonly PlacementDataset[];

export const columnMappingSchema = z
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

/** A downloaded mapping file, or why it is not one this page reads. */
export function parseMapping(
  json: string
): { ok: true; mapping: ColumnMapping } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, message: "The file is not JSON." };
  }
  const version = (value as { version?: unknown } | null)?.version;
  if (typeof version === "number" && version !== MAPPING_VERSION) {
    return {
      ok: false,
      message: `The column mapping is version ${version}, and this page reads version ${MAPPING_VERSION}.`,
    };
  }
  const parsed = columnMappingSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: `The file is not a column mapping: ${parsed.error.issues[0]?.message ?? "unknown problem"}.`,
    };
  }
  return { ok: true, mapping: parsed.data };
}

/** The mapping as the file "Download column mapping" saves. */
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

/** The required standard columns no header fills yet, in format order. */
export function unmappedRequired(mapping: ColumnMapping): string[] {
  const filled = new Set(Object.values(mapping.columns));
  return STANDARD_FORMATS[mapping.dataset].columns
    .filter((c) => c.required && !filled.has(c.name))
    .map((c) => c.name);
}

/** The headers the mapping reads that the file lacks, as the mapping spells them. */
export function missingHeaders(
  mapping: ColumnMapping,
  headers: readonly string[]
): string[] {
  const present = new Set(headers.map(normalizeHeader));
  return Object.keys(mapping.columns).filter(
    (h) => !present.has(normalizeHeader(h))
  );
}

const quoted = (names: readonly string[]) =>
  names.map((n) => `"${n}"`).join(", ");

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
): { issues: ImportIssue[]; rows: Record<string, string>[] } {
  const { fields, issues, rows } = parseRows(text);
  if (issues.some((i) => i.wholeFile)) {
    return { issues, rows: [] };
  }
  const missing = missingHeaders(mapping, fields);
  if (missing.length > 0) {
    return {
      issues: missing.map((header) =>
        stopped(
          `The file has no "${header}" column, which the column mapping reads as ${mapping.columns[header]}.`
        )
      ),
      rows: [],
    };
  }
  const pairs = Object.entries(mapping.columns).map(
    ([header, column]) => [normalizeHeader(header), column] as const
  );
  return {
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
  const stop = (message: string): Conversion => ({
    text: writeFormat(format, []),
    issues: [stopped(message)],
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
  const unmapped = unmappedRequired(mapping);
  if (unmapped.length > 0) {
    return stop(
      `The column mapping leaves ${quoted(unmapped)} unmapped, which the ${dataset} need.`
    );
  }
  const { issues, rows } = mapRows(text, mapping);
  return { text: writeFormat(format, rows), issues };
}

function customMapping(dataset: PlacementDataset): FilePlugin {
  return {
    id: CUSTOM_MAPPING_ID,
    label: "column-mapped",
    dataset,
    input: "file",
    description:
      "Read through your column mapping: each standard column takes the cell of the file column chosen for it, and an optional column left unmapped is blank. Each row of the file becomes one row of the converted CSV, in order, so the problems listed for the converted file follow your file's rows.",
    // No detect: nothing claims a file for it, staff choose it.
    toStandard: (text, { mapping }) => convert(dataset, text, mapping),
  };
}

/**
 * Custom mapping for each dataset, under one id, so a workspace stores
 * `readAs: "custom-mapping"` wherever the file is.
 */
export const CUSTOM_MAPPINGS: Record<PlacementDataset, FilePlugin> = {
  projects: customMapping("projects"),
  roster: customMapping("roster"),
  bids: customMapping("bids"),
};
