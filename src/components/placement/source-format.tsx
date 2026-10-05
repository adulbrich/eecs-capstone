import { Columns3, Download } from "lucide-react";
import { useId, useState } from "react";
import {
  ColumnMappingEditor,
  DownloadMappingButton,
} from "#/components/placement/column-mapping";
import { CsvFormatHelp } from "#/components/placement/csv-format";
import { ImportIssues } from "#/components/placement/import-issues";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import type { ImportIssue } from "#/lib/placement/csv";
import { CSV_EXTENSION, downloadText } from "#/lib/placement/download";
import {
  type PlacementDataset,
  STANDARD_FORMATS,
} from "#/lib/placement/formats";
import {
  type ReadAs,
  STANDARD_OPTION,
  uploadPlugins,
} from "#/lib/placement/plugins";
import type {
  ColumnMapping,
  Conversion,
  ImportPlugin,
} from "#/lib/placement/plugins/types";

/** The standard format's name in the Read as select. */
const STANDARD_LABELS: Record<PlacementDataset, string> = {
  projects: "Projects CSV",
  roster: "Roster CSV",
  bids: "Bids CSV",
};

/** "survey.csv" to "survey (converted).csv". */
const convertedFilename = (filename: string) =>
  filename.replace(CSV_EXTENSION, " (converted).csv");

function DownloadConverted({
  filename,
  text,
}: {
  filename: string;
  text: string;
}) {
  return (
    <Button
      onClick={() =>
        downloadText(convertedFilename(filename), text, "text/csv")
      }
      size="sm"
      type="button"
      variant="outline"
    >
      <Download aria-hidden="true" />
      Download converted CSV
    </Button>
  );
}

/**
 * A file read through a column mapping, with Edit and Download; and the
 * editor while it is open, which Apply closes.
 */
function MappingControls({
  dataset,
  filename,
  mapped,
  mapping,
  onMapping,
  open,
  setOpen,
  text,
}: {
  dataset: PlacementDataset;
  filename: string;
  /** True when the file is read through a column mapping now. */
  mapped: boolean;
  /** The column mapping stored with the file, in use or not. */
  mapping: ColumnMapping | undefined;
  onMapping: (mapping: ColumnMapping) => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  text: string;
}) {
  if (open) {
    return (
      <ColumnMappingEditor
        dataset={dataset}
        filename={filename}
        initial={mapping}
        kept
        // The file's own editor: another file starts from its own headers.
        key={text}
        onApply={(next) => {
          setOpen(false);
          onMapping(next);
        }}
        onCancel={() => setOpen(false)}
        text={text}
      />
    );
  }
  if (!mapped) {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        onClick={() => setOpen(true)}
        size="sm"
        type="button"
        variant="outline"
      >
        <Columns3 aria-hidden="true" />
        Edit column mapping
      </Button>
      {mapping !== undefined && (
        <DownloadMappingButton filename={filename} mapping={mapping} />
      )}
      <span className="text-muted-foreground">
        The column mapping is saved with this workspace and travels in its
        export. Choosing another format in Read as keeps it saved, and choosing
        Column mapping again reads through it.
      </span>
    </div>
  );
}

/**
 * How a stored file or pasted list is read (#733), and everything reading it
 * found: the plugin that converted it, with a download of what it converted
 * to; a Read as select to change it, for an uploaded file; what the plugin
 * noticed, in the source's own rows or lines; then what the dataset's parser
 * found in the standard CSV. A file nothing recognized is read as the standard
 * format, and gets that format's help when it is not one, with Map columns
 * to read it through a column mapping instead (#735).
 */
export function SourceFormat({
  conversion,
  dataset,
  filename,
  legacyConvertedFrom,
  mapping,
  onMapping,
  onReadAs,
  parseIssues,
  plugin,
  readAs,
  text,
}: {
  conversion: Conversion;
  dataset: PlacementDataset;
  /** The uploaded file's name; null for pasted text, which has no Read as. */
  filename: string | null;
  /**
   * The survey export's name, for a workspace saved before plugins converted
   * on read, which stored the converted CSV and its issues instead.
   */
  legacyConvertedFrom?: string;
  /** The column mapping stored with the file, in use or not. */
  mapping?: ColumnMapping;
  /** Reads the file through `mapping` from here on. */
  onMapping: (mapping: ColumnMapping) => void;
  /**
   * Null reads the file as the standard format; an id, through that plugin.
   * Custom mapping only once a column mapping is stored, which `onMapping`
   * stores.
   */
  onReadAs: (readAs: string | null) => void;
  parseIssues: readonly ImportIssue[];
  plugin: ImportPlugin | null;
  /** The stored choice: undefined while the file is read as detected. */
  readAs: ReadAs;
  /** The file or list as stored, which a column mapping reads. */
  text: string;
}) {
  const id = useId();
  const [mappingOpen, setMappingOpen] = useState(false);
  const plugins = uploadPlugins(dataset);
  const mapped = plugin?.input === "chosen";
  const conversionStopped = conversion.issues.some((i) => i.wholeFile);
  // Only when detection found nothing: staff who chose the standard format
  // for a file a plugin claims know what it is. A stored id no plugin has
  // any more was detected again, so it counts as detection.
  const unrecognized =
    plugin === null &&
    readAs !== null &&
    legacyConvertedFrom === undefined &&
    parseIssues.some((i) => i.wholeFile);
  return (
    <div className="mt-2 flex flex-col gap-2 text-sm">
      {/* A legacy workspace holds converted text, which no plugin reads
          again, so it has no Read as. */}
      {filename !== null &&
        legacyConvertedFrom === undefined &&
        plugins.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={id}>Read as</Label>
            <Select
              onValueChange={(value) => {
                // Column mapping with none saved opens the editor, and Apply
                // stores both; with one saved, it reads through it again.
                const chosen = plugins.find((p) => p.id === value);
                if (chosen?.input === "chosen" && mapping === undefined) {
                  setMappingOpen(true);
                  return;
                }
                setMappingOpen(false);
                onReadAs(value === STANDARD_OPTION ? null : value);
              }}
              value={plugin?.id ?? STANDARD_OPTION}
            >
              <SelectTrigger className="w-64" id={id} size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STANDARD_OPTION}>
                  {STANDARD_LABELS[dataset]}
                </SelectItem>
                {plugins.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.menuLabel ?? p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">
              Changing it reads the file again. Pins stay, and the last run
              stays on the Results tab, marked as before your changes.
            </span>
          </div>
        )}
      {filename !== null &&
        (plugin !== null || legacyConvertedFrom !== undefined) && (
          <div className="flex flex-wrap items-center gap-2">
            <span>
              Converted from the {plugin?.label ?? "Qualtrics export"}{" "}
              {legacyConvertedFrom ?? filename}.
            </span>
            <DownloadConverted
              filename={legacyConvertedFrom ?? filename}
              text={conversion.text}
            />
          </div>
        )}
      {plugin?.description !== undefined && <p>{plugin.description}</p>}
      {filename !== null && (
        <MappingControls
          dataset={dataset}
          filename={filename}
          mapped={mapped}
          mapping={mapping}
          onMapping={onMapping}
          open={mappingOpen}
          setOpen={setMappingOpen}
          text={text}
        />
      )}
      <ImportIssues
        issues={conversion.issues}
        label={
          plugin?.label ?? (legacyConvertedFrom ? "Qualtrics export" : dataset)
        }
        unit={plugin?.input === "paste" ? "line" : "row"}
      />
      {/* A source the plugin could not read leaves an empty CSV, whose
          missing columns would only repeat that (#681). */}
      {!conversionStopped && (
        <ImportIssues
          issues={parseIssues}
          label={
            plugin === null && legacyConvertedFrom === undefined
              ? dataset
              : `converted ${dataset}`
          }
        />
      )}
      {unrecognized && (
        <>
          <p>
            No format on this page recognized the file, so it was read as the
            standard format below. Map its columns to the standard format to
            read it as it is, or change the file to match.
          </p>
          {!mappingOpen && (
            <div>
              <Button
                onClick={() => setMappingOpen(true)}
                size="sm"
                type="button"
              >
                <Columns3 aria-hidden="true" />
                Map columns
              </Button>
            </div>
          )}
          <CsvFormatHelp format={STANDARD_FORMATS[dataset]} label={dataset} />
        </>
      )}
    </div>
  );
}
