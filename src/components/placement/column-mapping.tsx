import { Download, Upload } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useFilePicker } from "#/components/placement/file-picker-button";
import { Button } from "#/components/ui/button";
import { FieldError } from "#/components/ui/field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { ImportIssue } from "#/lib/placement/csv";
import { downloadText } from "#/lib/placement/download";
import {
  CSV_EXTENSION,
  type PlacementDataset,
  STANDARD_FORMATS,
} from "#/lib/placement/formats";
import {
  type ColumnMapping,
  fileHeaders,
  fitToDataset,
  mapRows,
  missingHeaders,
  normalizeHeader,
  parseMapping,
  presentIn,
  quoted,
  serializeMapping,
  suggestMapping,
  unmappedRequired,
} from "#/lib/placement/plugins/custom-mapping";

/** The Select value of a column no header fills: Radix refuses "". */
const UNMAPPED = "unmapped";
/** Header values carry a prefix, so a header named "unmapped" is still one. */
const headerValue = (header: string) => `header:${header}`;

/** How many converted rows the preview shows. */
const PREVIEW_ROWS = 5;

/** "roster.csv" to "roster (column mapping).json". */
const mappingFilename = (filename: string) =>
  filename.replace(CSV_EXTENSION, " (column mapping).json");

/** Saves a column mapping as the JSON file Load column mapping reads. */
export function DownloadMappingButton({
  filename,
  mapping,
}: {
  /** The uploaded file's name, which the download is named after. */
  filename: string;
  mapping: ColumnMapping;
}) {
  return (
    <Button
      onClick={() =>
        downloadText(
          mappingFilename(filename),
          serializeMapping(mapping),
          "application/json"
        )
      }
      size="sm"
      type="button"
      variant="outline"
    >
      <Download aria-hidden="true" />
      Download column mapping
    </Button>
  );
}

/**
 * What the editor starts from: the column mapping fitted to this dataset,
 * with the headers this file has spelled as it spells them, and the ones it
 * lacks kept as the mapping spells them, so the page can name them.
 */
function seed(
  mapping: ColumnMapping,
  dataset: PlacementDataset,
  headers: readonly string[]
): ColumnMapping {
  const fitted = fitToDataset(mapping, dataset);
  const present = presentIn(fitted, headers);
  const missing = missingHeaders(fitted, headers).map(
    (h) => [h, fitted.columns[h] ?? ""] as const
  );
  return {
    ...present,
    columns: { ...present.columns, ...Object.fromEntries(missing) },
  };
}

/** '"Team" (project)': a missing header and the column it filled. */
const missingLine = (mapping: ColumnMapping, headers: readonly string[]) =>
  headers.map((h) => `"${h}" (${mapping.columns[h]})`).join(", ");

/** What Apply waits for, or that it is ready. */
function applyStatus(
  dataset: PlacementDataset,
  unmapped: readonly string[],
  unreadable: readonly ImportIssue[]
): string {
  if (unreadable.length > 0) {
    return `${unreadable.map((i) => i.message).join(" ")} Fix the file and upload it again.`;
  }
  if (unmapped.length > 0) {
    return `Map ${quoted(unmapped)} to apply: the ${dataset} format requires ${unmapped.length === 1 ? "it" : "them"}.`;
  }
  return "Every required column is mapped.";
}

/**
 * Column mapping (#735): beside each standard column of the dataset, a
 * Select of the file's headers, prefilled where a header already names the
 * column; the first converted rows; and Apply, which waits for every
 * required column. A mapping downloads as JSON and loads again, for next
 * term's file or another department's.
 */
export function ColumnMappingEditor({
  dataset,
  filename,
  initial,
  kept,
  onApply,
  onCancel,
  text,
}: {
  dataset: PlacementDataset;
  filename: string;
  /** The mapping stored with the file, to edit; none suggests one. */
  initial?: ColumnMapping;
  /**
   * True when the workspace stores the mapping with the file (roster and
   * bids); false for projects, which are read once.
   */
  kept: boolean;
  onApply: (mapping: ColumnMapping) => void;
  onCancel: () => void;
  /** The file as uploaded. */
  text: string;
}) {
  const id = useId();
  const format = STANDARD_FORMATS[dataset];
  const headers = useMemo(() => fileHeaders(text), [text]);
  // Seeded once: the editor mounts when staff open it, and a new file
  // remounts it.
  const [mapping, setMapping] = useState(() =>
    seed(initial ?? suggestMapping(dataset, headers), dataset, headers)
  );
  const [loadError, setLoadError] = useState<string | null>(null);

  const picker = useFilePicker({
    accept: ".json,application/json",
    inputLabel: "Column mapping file",
    onText: (json) => {
      const parsed = parseMapping(json);
      if (!parsed.ok) {
        setLoadError(parsed.message);
        return;
      }
      if (parsed.mapping.dataset !== dataset) {
        setLoadError(
          `The column mapping is for the ${parsed.mapping.dataset}, not the ${dataset}.`
        );
        return;
      }
      setLoadError(null);
      setMapping(seed(parsed.mapping, dataset, headers));
    },
  });

  // Keyed by header, so one header fills one column: choosing it for
  // another column moves it there. A header this file lacks stays in the
  // mapping, and named, until its column takes another header.
  const choose = (column: string, value: string) =>
    setMapping((current) => {
      const chosen = headers.find((h) => headerValue(h) === value);
      const columns = Object.fromEntries(
        Object.entries(current.columns).filter(
          ([h, c]) =>
            c !== column &&
            (chosen === undefined ||
              normalizeHeader(h) !== normalizeHeader(chosen))
        )
      );
      if (chosen !== undefined) {
        columns[chosen] = column;
      }
      return { ...current, columns };
    });

  // What Apply stores and the preview reads: the headers this file has.
  const usable = useMemo(() => presentIn(mapping, headers), [mapping, headers]);
  const missing = missingHeaders(mapping, headers);
  const headerFor = (column: string) =>
    Object.entries(usable.columns).find(([, c]) => c === column)?.[0];
  const unmapped = unmappedRequired(usable);
  const mapped = format.columns.filter((c) => headerFor(c.name) !== undefined);
  const read = useMemo(() => mapRows(text, usable), [text, usable]);
  const preview = read.rows.slice(0, PREVIEW_ROWS);
  // A file whose header cannot be read at all, as one naming a column
  // twice: no mapping reads it, so Apply waits for a new file.
  const unreadable = read.issues.filter((i) => i.wholeFile);
  const statusId = `${id}-status`;

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="flex flex-col gap-3 rounded-md border px-3 py-2 text-sm"
    >
      <h3 className="font-medium" id={`${id}-heading`}>
        Map the columns of {filename}
      </h3>
      <p className="text-muted-foreground">
        Choose the column of your file that holds each column of the {dataset}{" "}
        format. Each row of the file becomes one row, and an optional column
        left as Not in the file is blank. A file column fills one column here,
        so choosing it for a second one moves it.{" "}
        {kept
          ? "Applying saves the column mapping with this workspace: the file is read through it on every visit, and it travels in the workspace export."
          : "Applying reads the projects once; the column mapping is not kept, so download it first to use it again."}{" "}
        Download it to read next term's file, or another department's, the same
        way. It stays in this browser and in the files you save.
      </p>
      <ul className="flex flex-col divide-y">
        {format.columns.map((c) => {
          const header = headerFor(c.name);
          return (
            <li
              className="grid gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-center sm:gap-4"
              key={c.name}
            >
              <div>
                <span className="font-mono">{c.name}</span>{" "}
                <span className="text-muted-foreground">
                  {c.required ? "required" : "optional"}
                </span>
                <p className="text-muted-foreground text-xs">{c.meaning}</p>
              </div>
              <Select
                onValueChange={(value) => choose(c.name, value)}
                value={header === undefined ? UNMAPPED : headerValue(header)}
              >
                <SelectTrigger
                  aria-label={`File column for ${c.name}`}
                  className="w-full"
                  size="sm"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNMAPPED}>Not in the file</SelectItem>
                  {headers.map((h) => (
                    <SelectItem key={h} value={headerValue(h)}>
                      {h}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </li>
          );
        })}
      </ul>
      {missing.length > 0 && (
        <p role="status" style={{ color: "var(--status-warning)" }}>
          This file has no {missingLine(mapping, missing)}, which the column
          mapping reads. Choose another file column for{" "}
          {missing.length === 1 ? "it" : "them"}; Apply leaves out what is still
          missing.
        </p>
      )}
      {/* A plain table, as CsvFormatHelp's is: a few read-only rows with no
          sorting, paging or row actions, where AdminDataTable would add
          nothing. */}
      {mapped.length > 0 && preview.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="mb-1 text-left text-muted-foreground text-sm">
              The first{" "}
              {preview.length === 1 ? "row" : `${preview.length} rows`} as
              converted
            </caption>
            <thead>
              <tr>
                {mapped.map((c) => (
                  <th
                    className="py-1 pr-3 font-medium font-mono"
                    key={c.name}
                    scope="col"
                  >
                    {c.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {preview.map((row, i) => (
                // The preview is read only and never reorders.
                // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
                <tr className="border-t align-top" key={i}>
                  {mapped.map((c) => (
                    <td className="py-1 pr-3" key={c.name}>
                      {row[c.name] || "-"}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p id={statusId}>{applyStatus(dataset, unmapped, unreadable)}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          aria-describedby={statusId}
          disabled={unmapped.length > 0 || unreadable.length > 0}
          onClick={() => onApply(usable)}
          size="sm"
          type="button"
        >
          Apply column mapping
        </Button>
        <DownloadMappingButton filename={filename} mapping={mapping} />
        <Button onClick={picker.open} size="sm" type="button" variant="outline">
          <Upload aria-hidden="true" />
          Load column mapping
        </Button>
        {picker.input}
        <Button onClick={onCancel} size="sm" type="button" variant="ghost">
          Cancel
        </Button>
      </div>
      {/* The picker's own error first: a file it could not read is newer
          than any parse message, which a new pick clears on success. */}
      <FieldError message={picker.error ?? loadError} />
    </section>
  );
}
