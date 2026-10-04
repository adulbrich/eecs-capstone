import { Download } from "lucide-react";
import { useId } from "react";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { downloadText } from "#/lib/placement/download";
import type { PlacementDataset } from "#/lib/placement/formats";
import { filePlugins } from "#/lib/placement/plugins";
import type { PlacementPlugin } from "#/lib/placement/plugins/types";

const STANDARD = "standard";
const CSV_EXTENSION = /(\.csv)?$/i;

/** A filename for a file's standard CSV: "survey.csv" to "survey (converted).csv". */
export const convertedFilename = (filename: string) =>
  filename.replace(CSV_EXTENSION, " (converted).csv");

/**
 * How an uploaded file is read (#733): the plugin that converted it, with a
 * download of what it converted to, and a Read as select to change it when
 * the dataset has more than one way to read a file. Detection picks the
 * first way; staff override it here.
 */
export function SourceFormat({
  dataset,
  filename,
  onReadAs,
  plugin,
  standardLabel,
  standardText,
}: {
  dataset: PlacementDataset;
  filename: string;
  /** Null reads the file as the standard format; an id, through that plugin. */
  onReadAs: (pluginId: string | null) => void;
  plugin: PlacementPlugin | null;
  /** The standard format's name in the select, as in "Bids CSV". */
  standardLabel: string;
  standardText: string;
}) {
  const id = useId();
  const others = filePlugins(dataset);
  return (
    <div className="mt-2 flex flex-col gap-2 text-sm">
      {others.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <Label htmlFor={id}>Read as</Label>
          <Select
            onValueChange={(value) =>
              onReadAs(value === STANDARD ? null : value)
            }
            value={plugin?.id ?? STANDARD}
          >
            <SelectTrigger className="w-64" id={id} size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={STANDARD}>{standardLabel}</SelectItem>
              {others.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {plugin !== null && (
        <div className="flex flex-wrap items-center gap-2">
          <span>
            Converted from the {plugin.label} {filename}.
          </span>
          <Button
            onClick={() =>
              downloadText(
                convertedFilename(filename),
                standardText,
                "text/csv"
              )
            }
            size="sm"
            type="button"
            variant="outline"
          >
            <Download aria-hidden="true" />
            Download converted CSV
          </Button>
        </div>
      )}
      {plugin?.description !== undefined && <p>{plugin.description}</p>}
    </div>
  );
}
