import { type ImportIssue, parseRows } from "#/lib/placement/csv";
import {
  type ExportDataset,
  type PlacementDataset,
  STANDARD_FORMATS,
} from "#/lib/placement/formats";
import { canvasGroups, canvasRoster } from "#/lib/placement/plugins/canvas";
import { CUSTOM_MAPPINGS } from "#/lib/placement/plugins/custom-mapping";
import { pastedRoster, pastedTitles } from "#/lib/placement/plugins/paste";
import { qualtricsBids } from "#/lib/placement/plugins/qualtrics";
import type {
  Conversion,
  ExportContext,
  ExportedFile,
  ExportPlugin,
  FilePlugin,
  ImportPlugin,
  PluginContext,
} from "#/lib/placement/plugins/types";

/**
 * Every import plugin. A file is tried against its dataset's standard
 * format first, then against each file plugin here in order, and the first
 * that claims it reads it. Add a plugin by adding it to this list. Custom
 * mapping comes last, once per dataset under one id: nothing detects it, and
 * Read as lists it after the formats that are.
 */
export const PLUGINS: readonly ImportPlugin[] = [
  canvasRoster,
  qualtricsBids,
  pastedRoster,
  pastedTitles,
  ...Object.values(CUSTOM_MAPPINGS),
];

/**
 * The standard format's value in the Read as and Download as selects, beside
 * plugin ids, so no plugin may take it as its id: the contract test checks.
 */
export const STANDARD_OPTION = "standard";

/**
 * Every export plugin, offered by "Download as" after the dataset's standard
 * CSV, in this order. Add one by adding it to this list.
 */
export const EXPORT_PLUGINS: readonly ExportPlugin[] = [canvasGroups];

/** The export plugins that write `dataset`, in the order "Download as" lists them. */
export function exportPlugins(dataset: ExportDataset): ExportPlugin[] {
  return EXPORT_PLUGINS.filter((p) => p.dataset === dataset);
}

/**
 * The plugin `id` names for `dataset`. An id is unique within a dataset; only
 * custom mapping uses one id for several.
 */
export function pluginById(
  dataset: PlacementDataset,
  id: string
): ImportPlugin | undefined {
  return PLUGINS.find((p) => p.id === id && p.dataset === dataset);
}

/**
 * The plugins that read an uploaded file of `dataset`, in detection order:
 * what Read as lists.
 */
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
  return filePlugins(dataset).find((p) => p.detect?.(text) === true) ?? null;
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
  const chosen = readAs === undefined ? undefined : pluginById(dataset, readAs);
  return chosen?.input === "file" ? chosen : detectPlugin(dataset, text);
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
 * A plugin that threw, as the one problem with the whole file: `failure`
 * says what could not be done, as "The Canvas roster export could not be
 * read".
 */
function thrown(failure: string, error: unknown): ImportIssue[] {
  const reason = (
    error instanceof Error ? error.message : String(error)
  ).replace(TRAILING_STOP, "");
  return [
    {
      level: "error",
      row: 1,
      message: `${failure}: ${reason}.`,
      wholeFile: true,
    },
  ];
}

/**
 * The text as standard CSV: through `plugin`, or as it is when null. A
 * plugin that throws is reported as a problem with the whole file, because
 * the file stays stored and is read again on every load: an exception here
 * would otherwise break the page until staff cleared their browser.
 */
export function toStandard(
  plugin: ImportPlugin | null,
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
      issues: thrown(`The ${plugin.label} could not be read`, error),
    };
  }
}

/**
 * The standard CSV as a file to download: through `plugin`, or as it is when
 * null. A plugin that throws is reported as a problem with the whole file,
 * so the page can say so rather than the download doing nothing.
 */
export function exportWith(
  plugin: ExportPlugin | null,
  text: string,
  context: ExportContext
): ExportedFile {
  if (plugin === null) {
    return { filename: context.filename, text, issues: [] };
  }
  try {
    return plugin.fromStandard(text, context);
  } catch (error) {
    return {
      filename: context.filename,
      text: "",
      issues: thrown(`The ${plugin.label} file could not be written`, error),
    };
  }
}
