import { parseRows } from "#/lib/placement/csv";
import {
  type PlacementDataset,
  STANDARD_FORMATS,
} from "#/lib/placement/formats";
import { canvasRoster } from "#/lib/placement/plugins/canvas";
import { pastedRoster, pastedTitles } from "#/lib/placement/plugins/paste";
import { qualtricsBids } from "#/lib/placement/plugins/qualtrics";
import type {
  Conversion,
  FilePlugin,
  PlacementPlugin,
  PluginContext,
} from "#/lib/placement/plugins/types";

/**
 * Every placement plugin. A file is tried against its dataset's standard
 * format first, then against each file plugin here in order, and the first
 * that claims it reads it. Add a plugin by adding it to this list.
 */
export const PLUGINS: readonly PlacementPlugin[] = [
  canvasRoster,
  qualtricsBids,
  pastedRoster,
  pastedTitles,
];

export function pluginById(id: string): PlacementPlugin | undefined {
  return PLUGINS.find((p) => p.id === id);
}

/** The plugins that read an uploaded file of `dataset`, in detection order. */
export function filePlugins(dataset: PlacementDataset): FilePlugin[] {
  return PLUGINS.filter(
    (p): p is FilePlugin => p.input === "file" && p.dataset === dataset
  );
}

/** True when the header has every column the standard format requires. */
export function isStandard(dataset: PlacementDataset, text: string): boolean {
  const { fields } = parseRows(text);
  return STANDARD_FORMATS[dataset].columns
    .filter((c) => c.required)
    .every((c) => fields.includes(c.name));
}

/** The plugin that claims a file, or null for the standard format. */
export function detectPlugin(
  dataset: PlacementDataset,
  text: string
): FilePlugin | null {
  if (isStandard(dataset, text)) {
    return null;
  }
  return filePlugins(dataset).find((p) => p.detect(text)) ?? null;
}

/**
 * How staff chose to read a file: undefined to detect it, null for the
 * standard format, or a plugin's id. An id no plugin has any more, from a
 * workspace saved before it was removed, is detected again.
 */
export type ReadAs = string | null | undefined;

/** The plugin a stored file is read through, or null for the standard. */
export function resolveFilePlugin(
  dataset: PlacementDataset,
  text: string,
  readAs: ReadAs
): FilePlugin | null {
  if (readAs === null) {
    return null;
  }
  const chosen = readAs === undefined ? undefined : pluginById(readAs);
  return chosen?.input === "file" && chosen.dataset === dataset
    ? chosen
    : detectPlugin(dataset, text);
}

/**
 * What to store for staff's Read as choice: nothing when it is what detection
 * picks anyway, so switching away and back leaves the workspace, and the
 * last run's fingerprint, as they were.
 */
export function readAsChoice(
  dataset: PlacementDataset,
  text: string,
  choice: string | null
): ReadAs {
  return (detectPlugin(dataset, text)?.id ?? null) === choice
    ? undefined
    : choice;
}

const TRAILING_STOP = /\.$/;

/**
 * The text as standard CSV: through `plugin`, or as it is when null. A
 * plugin that throws is reported as a problem with the whole file, because
 * the file stays stored and is read again on every load: an exception here
 * would otherwise break the page until staff cleared their browser.
 */
export function toStandard(
  plugin: PlacementPlugin | null,
  text: string,
  context: PluginContext
): Conversion {
  if (plugin === null) {
    return { text, issues: [] };
  }
  try {
    return plugin.toStandard(text, context);
  } catch (error) {
    return {
      text: "",
      issues: [
        {
          level: "error",
          row: 1,
          message: `The ${plugin.label} could not be read: ${(error instanceof Error ? error.message : String(error)).replace(TRAILING_STOP, "")}.`,
          wholeFile: true,
        },
      ],
    };
  }
}
