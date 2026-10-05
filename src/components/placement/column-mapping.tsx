import { Download, Upload } from "lucide-react";
import { useId, useMemo, useState } from "react";
import { useFilePicker } from "#/components/placement/file-picker-button";
import { Button } from "#/components/ui/button";
import { Checkbox } from "#/components/ui/checkbox";
import { FieldError } from "#/components/ui/field";
import { Input } from "#/components/ui/input";
import { Label } from "#/components/ui/label";
import { RadioGroup, RadioGroupItem } from "#/components/ui/radio-group";
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
  asSentence,
  type ColumnMapping,
  columnMapping,
  droppedColumns,
  fileHeaders,
  fitToDataset,
  mapRows,
  missingHeaders,
  normalizeHeader,
  parseMapping,
  presentIn,
  quoted,
  readsAs,
  STUDENT_COLUMNS,
  serializeMapping,
  suggestMapping,
  unmappedRequired,
  type WideBids,
  wideProblems,
} from "#/lib/placement/plugins/custom-mapping";
import { QUALTRICS_SEPARATOR } from "#/lib/placement/plugins/header-title";

/** The Select value of a column no header fills: Radix refuses "". */
const UNMAPPED = "unmapped";
/** Header values carry a prefix, so a header named "unmapped" is still one. */
const headerValue = (header: string) => `header:${header}`;

/** How many converted rows the preview shows. */
const PREVIEW_ROWS = 5;

/** The bids columns the project columns fill when the file is read wide. */
const FROM_PROJECT_COLUMNS = new Set(["priority", "project"]);

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
 * Wide reading as the editor holds it (#736): both ways of choosing the
 * project columns and both ways of reading a title, so switching from one
 * to the other and back keeps what staff typed or ticked.
 */
export interface WideDraft {
  by: "prefix" | "headers";
  /** The headers ticked, as the file or a loaded column mapping spells them. */
  headers: string[];
  on: boolean;
  prefix: string;
  separator: string;
  titleBy: "separator" | "brackets";
}

/** The editor's wide reading for a column mapping's, or off. */
export function wideDraft(wide: WideBids | undefined): WideDraft {
  const set = wide?.projectColumns;
  const title = wide?.title;
  return {
    on: wide !== undefined,
    by: set?.by ?? "prefix",
    prefix: set?.by === "prefix" ? set.prefix : "",
    headers: set?.by === "headers" ? set.headers : [],
    titleBy: title?.by ?? "separator",
    separator:
      title?.by === "separator" ? title.separator : QUALTRICS_SEPARATOR,
  };
}

/**
 * The column mapping the editor has made: wide reading only while it is on
 * and only for the bids, and then only the student columns' headers, which
 * are all a header may fill when the project columns fill the rest.
 */
export function editedMapping(
  dataset: PlacementDataset,
  columns: Record<string, string>,
  draft: WideDraft
): ColumnMapping {
  if (!(draft.on && dataset === "bids")) {
    return columnMapping(dataset, columns);
  }
  return columnMapping(
    dataset,
    Object.fromEntries(
      Object.entries(columns).filter(([, c]) => STUDENT_COLUMNS.includes(c))
    ),
    {
      projectColumns:
        draft.by === "prefix"
          ? { by: "prefix", prefix: draft.prefix }
          : { by: "headers", headers: draft.headers },
      title:
        draft.titleBy === "brackets"
          ? { by: "brackets" }
          : { by: "separator", separator: draft.separator },
    }
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
  const missing = Object.entries(fitted.columns).filter(([h]) =>
    missingHeaders(fitted, headers).includes(h)
  );
  return {
    ...present,
    columns: { ...present.columns, ...Object.fromEntries(missing) },
  };
}

/**
 * '"Team" (project)': a missing header and what the column mapping reads it
 * as.
 */
const missingLine = (mapping: ColumnMapping, headers: readonly string[]) =>
  headers.map((h) => `"${h}" (${readsAs(mapping, h)})`).join(", ");

/**
 * What Apply waits for, or that it is ready, after any pair the column
 * mapping lost to fit this dataset. `problems` are what the column mapping
 * itself gets wrong for this file, as sentences.
 */
export function applyStatus(
  dataset: PlacementDataset,
  unmapped: readonly string[],
  unreadable: readonly ImportIssue[],
  dropped: readonly string[] = [],
  problems: readonly string[] = []
): string {
  const lost =
    dropped.length === 0
      ? ""
      : `${dropped.join(", ")} ${dropped.length === 1 ? "is" : "are"} not in the ${dataset} format, so the column mapping leaves ${dropped.length === 1 ? "it" : "them"} out. `;
  if (unreadable.length > 0) {
    return `${lost}${unreadable.map((i) => i.message).join(" ")} Fix the file and upload it again.`;
  }
  if (problems.length > 0) {
    return `${lost}${problems.join(" ")} Change the column mapping to apply it.`;
  }
  if (unmapped.length > 0) {
    return `${lost}Map ${quoted(unmapped)} to apply: the ${dataset} format requires ${unmapped.length === 1 ? "it" : "them"}.`;
  }
  return `${lost}Every required column is mapped.`;
}

type DraftChange = (change: Partial<WideDraft>) => void;

/** How a bids file is laid out (#736), and what reading it wide does. */
function LayoutChoice({
  draft,
  onDraft,
}: {
  draft: WideDraft;
  onDraft: DraftChange;
}) {
  const id = useId();
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="font-medium">How the file is laid out</legend>
      <RadioGroup
        aria-describedby={`${id}-hint`}
        className="gap-1"
        onValueChange={(v) => onDraft({ on: v === "wide" })}
        value={draft.on ? "wide" : "long"}
      >
        <Label className="min-h-7 font-normal">
          <RadioGroupItem value="long" />
          One row per bid
        </Label>
        <Label className="min-h-7 font-normal">
          <RadioGroupItem value="wide" />
          One row per student, one column per project
        </Label>
      </RadioGroup>
      <p className="text-muted-foreground text-xs" id={`${id}-hint`}>
        With one column per project, as a Google Forms grid or a Qualtrics
        ranking exports it, each project column's cell is the student's priority
        for that project, and the project's title comes from the column's
        header. Each filled cell becomes one bid. A blank cell is no bid:
        nothing is read from it, and a student who left every project blank has
        no bids. The email, name and avoid columns repeat on every bid from the
        student's row.
      </p>
    </fieldset>
  );
}

/**
 * With one column per project (#736): which columns those are, and where
 * each header holds its title. Every choice is kept while another is in use.
 */
function ProjectColumnSettings({
  draft,
  headers,
  onDraft,
}: {
  draft: WideDraft;
  headers: readonly string[];
  onDraft: DraftChange;
}) {
  const id = useId();
  const ticked = new Set(draft.headers.map(normalizeHeader));
  const tick = (header: string, on: boolean) =>
    onDraft({
      headers: on
        ? [...draft.headers, header]
        : draft.headers.filter(
            (h) => normalizeHeader(h) !== normalizeHeader(header)
          ),
    });
  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Project columns</legend>
        <RadioGroup
          className="gap-1"
          onValueChange={(v) =>
            onDraft({ by: v === "headers" ? "headers" : "prefix" })
          }
          value={draft.by}
        >
          <Label className="min-h-7 font-normal">
            <RadioGroupItem value="prefix" />
            Every column whose header starts with
          </Label>
          <Label className="min-h-7 font-normal">
            <RadioGroupItem value="headers" />
            The columns I tick
          </Label>
        </RadioGroup>
        {draft.by === "prefix" ? (
          <Input
            aria-label="Project columns' headers start with"
            className="sm:w-80"
            onChange={(e) => onDraft({ prefix: e.target.value })}
            placeholder="Rank the projects"
            value={draft.prefix}
          />
        ) : (
          <ul
            aria-label="Project columns"
            className="flex max-h-56 flex-col overflow-y-auto rounded-md border px-2 py-1"
          >
            {headers.map((h) => (
              <li key={h}>
                <Label className="min-h-7 font-normal">
                  <Checkbox
                    checked={ticked.has(normalizeHeader(h))}
                    onCheckedChange={(on) => tick(h, on === true)}
                  />
                  {h}
                </Label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>
      <fieldset className="flex flex-col gap-1">
        <legend className="font-medium">Project title</legend>
        <RadioGroup
          className="gap-1"
          onValueChange={(v) =>
            onDraft({
              titleBy: v === "brackets" ? "brackets" : "separator",
            })
          }
          value={draft.titleBy}
        >
          <Label className="min-h-7 font-normal">
            <RadioGroupItem value="separator" />
            The text after a separator
          </Label>
          <Label className="min-h-7 font-normal">
            <RadioGroupItem value="brackets" />
            The text inside the last square brackets
          </Label>
        </RadioGroup>
        {draft.titleBy === "separator" ? (
          <>
            <Input
              aria-describedby={`${id}-separator-hint`}
              aria-label="Title separator"
              className="sm:w-40"
              onChange={(e) => onDraft({ separator: e.target.value })}
              value={draft.separator}
            />
            <p
              className="text-muted-foreground text-xs"
              id={`${id}-separator-hint`}
            >
              Spaces count: " - " is a dash with a space each side, as Qualtrics
              writes it. The title is everything after the first one, so a title
              with the separator in it stays whole.
            </p>
          </>
        ) : (
          <p className="text-muted-foreground text-xs">
            As a Google Forms grid writes "Rank the projects [Tide Clock]".
          </p>
        )}
      </fieldset>
    </div>
  );
}

/**
 * Column mapping (#735): beside each standard column of the dataset, a
 * Select of the file's headers, prefilled where a header already names the
 * column; the first converted rows; and Apply, which waits for every
 * required column. A mapping downloads as JSON and loads again, for next
 * term's file or another department's. A bids file may be read wide, one
 * column per project (#736).
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
  // Wide reading, held apart from the columns so turning it off and on
  // again keeps both (#736).
  const [draft, setDraft] = useState(() =>
    wideDraft(initial && fitToDataset(initial, dataset).wide)
  );
  // The pairs the stored column mapping lost to fit this dataset, until
  // another is loaded.
  const [dropped, setDropped] = useState(() =>
    initial === undefined ? [] : droppedColumns(initial, dataset)
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const wide = draft.on && dataset === "bids";
  const onDraft: DraftChange = (change) =>
    setDraft((d) => ({ ...d, ...change }));

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
      setDropped([]);
      setMapping(seed(parsed.mapping, dataset, headers));
      setDraft(wideDraft(parsed.mapping.wide));
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

  // What Download saves, missing headers and all, and what Apply stores and
  // the preview reads: the headers this file has.
  const edited = useMemo(
    () => editedMapping(dataset, mapping.columns, draft),
    [dataset, mapping.columns, draft]
  );
  const usable = useMemo(() => presentIn(edited, headers), [edited, headers]);
  const missing = missingHeaders(edited, headers);
  const headerFor = (column: string) =>
    Object.entries(usable.columns).find(([, c]) => c === column)?.[0];
  const unmapped = unmappedRequired(usable);
  // What the column mapping gets wrong before the file is read, a blank
  // separator say, comes first: the file is not read wide until it is right.
  const read = useMemo(() => {
    const settings = wideProblems(usable).map(asSentence);
    return settings.length > 0
      ? { issues: [], problems: settings, rows: [], titles: undefined }
      : mapRows(text, usable);
  }, [text, usable]);
  const { problems } = read;
  // With one column per project, a header fills only the student columns.
  const shown = format.columns.filter(
    (c) => !wide || STUDENT_COLUMNS.includes(c.name)
  );
  const mapped = format.columns.filter(
    (c) =>
      headerFor(c.name) !== undefined ||
      (wide && FROM_PROJECT_COLUMNS.has(c.name))
  );
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
        {wide
          ? "Choose the columns of your file that say who the student is, then which columns hold one project each."
          : `Choose the column of your file that holds each column of the ${dataset} format. Each row of the file becomes one row, and an optional column left as Not in the file is blank.`}{" "}
        A file column fills one column here, so choosing it for a second one
        moves it.{" "}
        {kept
          ? "Applying saves the column mapping with this workspace: the file is read through it on every visit, and it travels in the workspace export."
          : "Applying reads the projects once; the column mapping is not kept, so download it first to use it again."}{" "}
        Download it to read next term's file, or another department's, the same
        way. It stays in this browser and in the files you save.
      </p>
      {dataset === "bids" && <LayoutChoice draft={draft} onDraft={onDraft} />}
      <ul className="flex flex-col divide-y">
        {shown.map((c) => {
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
      {wide && (
        <ProjectColumnSettings
          draft={draft}
          headers={headers}
          onDraft={onDraft}
        />
      )}
      {missing.length > 0 && (
        <p role="status" style={{ color: "var(--status-warning)" }}>
          This file has no {missingLine(edited, missing)}, which the column
          mapping reads. Choose another file column for{" "}
          {missing.length === 1 ? "it" : "them"}; Apply leaves out what is still
          missing.
        </p>
      )}
      {read.titles !== undefined && (
        <p>
          {read.titles.length === 1
            ? "1 project column"
            : `${read.titles.length} project columns`}
          : {read.titles.join(", ")}.
        </p>
      )}
      {/* A plain table, as CsvFormatHelp's is: a few read-only rows with no
          sorting, paging or row actions, where AdminDataTable would add
          nothing. */}
      {mapped.length > 0 && preview.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="mb-1 text-left text-muted-foreground text-sm">
              {wide
                ? `The first ${preview.length === 1 ? "bid" : `${preview.length} bids`} as converted, one row each`
                : `The first ${preview.length === 1 ? "row" : `${preview.length} rows`} as converted`}
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
      <p id={statusId}>
        {applyStatus(dataset, unmapped, unreadable, dropped, problems)}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          aria-describedby={statusId}
          disabled={
            unmapped.length > 0 || unreadable.length > 0 || problems.length > 0
          }
          onClick={() => onApply(usable)}
          size="sm"
          type="button"
        >
          Apply column mapping
        </Button>
        <DownloadMappingButton filename={filename} mapping={edited} />
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
