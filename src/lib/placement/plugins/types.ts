import type { ImportIssue } from "#/lib/placement/csv";
import type { ExportDataset, PlacementDataset } from "#/lib/placement/formats";
import type { WorkspaceProject } from "#/lib/placement/types";

/**
 * An import plugin reads one source's own shape and writes the dataset's
 * standard CSV (`STANDARD_FORMATS`), which the one parser per dataset then
 * reads (ADR-0059). An export plugin goes the other way, from what placement
 * writes (`EXPORT_FORMATS`) to another tool's shape (#734). Plugins are
 * modules in this folder, registered in `index.ts` by a pull request; nothing
 * is uploaded or loaded at run time. `docs/placement-plugins.md` says how to
 * write one.
 */

/**
 * Wide reading of a bids file (#736): one row per student and one column
 * per project, the cell holding the student's priority for it. Each filled
 * cell becomes one bid, titled from its column's header.
 */
export interface WideBids {
  /**
   * The project columns: every header that starts with `prefix`, or the
   * headers listed, as the file spells them. Case and spaces around a
   * header are ignored, as they are for `columns`.
   */
  projectColumns:
    | { by: "prefix"; prefix: string }
    | { by: "headers"; headers: string[] };
  /**
   * Where a project column's header holds the title: after the first
   * `separator`, or inside the last pair of square brackets.
   */
  title: { by: "separator"; separator: string } | { by: "brackets" };
}

/**
 * Which header of a file fills each standard column of a dataset (#735):
 * what custom mapping reads a file through. Data, never code.
 */
export interface ColumnMapping {
  /**
   * Each header the column mapping reads, as the file spells it, and the
   * standard column it fills. Header case and spaces around it are ignored,
   * as the standard format ignores them. With `wide`, only the student
   * columns: email, name and avoid.
   */
  columns: Record<string, string>;
  dataset: PlacementDataset;
  /**
   * The shape's number: 2 with `wide`, 1 without, so a column mapping with
   * no wide reading still loads on a page that reads only version 1.
   */
  version: 1 | 2;
  /** Wide reading, for the bids only (#736). */
  wide?: WideBids;
}

/** What a plugin may read besides the text. */
export interface PluginContext {
  /**
   * The column mapping stored with the file (#735), which only custom
   * mapping reads.
   */
  mapping?: ColumnMapping;
  /** The project list as it is now, for a source that names projects. */
  projects: readonly Pick<WorkspaceProject, "title">[];
}

export interface Conversion {
  /**
   * What the plugin noticed, in the source's own rows (or lines, for pasted
   * text), so staff can find each one in what they uploaded.
   */
  issues: ImportIssue[];
  /** The standard CSV, header included, of every row the plugin kept. */
  text: string;
}

interface PluginBase {
  /** The dataset whose standard CSV the plugin writes. */
  dataset: PlacementDataset;
  /** Shown while a source is read through the plugin; plain prose. */
  description?: string;
  /** Stable: a workspace stores it, so renaming one breaks saved choices. */
  id: string;
  /**
   * The source's name on the page: "Converted from the <label> x.csv" for a
   * file, "Problems in the pasted <label>" for pasted text.
   */
  label: string;
  /** The option's name in Read as, when it is not `label`. */
  menuLabel?: string;
  /**
   * The source as standard CSV. Rows it reports an error on are left out,
   * and rows it keeps should already be valid and unique, so the standard
   * parser finds nothing more to say about them.
   */
  toStandard: (text: string, context: PluginContext) => Conversion;
}

/** An uploaded file, recognized by its content. */
export interface FilePlugin extends PluginBase {
  /**
   * True when the text is this plugin's source. Never true for the
   * dataset's standard format, which is tried first, or for another
   * plugin's source: the contract test checks both.
   */
  detect: (text: string) => boolean;
  input: "file";
}

/**
 * An uploaded file read the way staff chose, never detected: offered by
 * Read as and by Map columns, and reading what staff chose from the
 * context. Custom mapping is the one (#735).
 */
export interface ChosenPlugin extends PluginBase {
  input: "chosen";
}

/** Text pasted into a box on the page; issues name lines, not rows. */
export interface PastePlugin extends PluginBase {
  input: "paste";
}

/** A plugin that reads an uploaded file: detected, or chosen. */
export type UploadPlugin = FilePlugin | ChosenPlugin;

/** An import plugin: one that reads a source into placement. */
export type ImportPlugin = UploadPlugin | PastePlugin;

/** What an export plugin may read besides the text. */
export interface ExportContext {
  /** The standard file's name, as the download would save it. */
  filename: string;
}

export interface ExportedFile {
  /** The name the download saves the file under. */
  filename: string;
  /**
   * What the plugin noticed, in the standard CSV's rows, so staff can find
   * each one in the standard download.
   */
  issues: ImportIssue[];
  /** The file, header included, of every row the plugin kept. */
  text: string;
}

/**
 * A plugin that writes what placement wrote in another tool's shape, for
 * "Download as". It has no `detect`: staff choose it.
 */
export interface ExportPlugin {
  /** The dataset whose standard CSV the plugin reads. */
  dataset: ExportDataset;
  /**
   * Shown while the plugin is chosen: what the other tool does with the
   * file, and what the file leaves out. Plain prose.
   */
  description: string;
  fromStandard: (text: string, context: ExportContext) => ExportedFile;
  /** Unique across every plugin, import or export. */
  id: string;
  /** The option's name in "Download as". */
  label: string;
  /**
   * The columns the other tool needs, which the contract test checks the
   * plugin writes.
   */
  requiredColumns: readonly string[];
}
