import type { ImportIssue } from "#/lib/placement/csv";
import type { ExportDataset, PlacementDataset } from "#/lib/placement/formats";
import type { ColumnMapping } from "#/lib/placement/plugins/custom-mapping";
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
  /**
   * The source as standard CSV. Rows it reports an error on are left out,
   * and rows it keeps should already be valid and unique, so the standard
   * parser finds nothing more to say about them.
   */
  toStandard: (text: string, context: PluginContext) => Conversion;
}

/** An uploaded file, recognized by its content or chosen by staff. */
export interface FilePlugin extends PluginBase {
  /**
   * True when the text is this plugin's source. Never true for the
   * dataset's standard format, which is tried first, or for another
   * plugin's source: the contract test checks both. Absent for a plugin
   * nothing detects, which staff choose with Read as, as custom mapping is.
   */
  detect?: (text: string) => boolean;
  input: "file";
}

/** Text pasted into a box on the page; issues name lines, not rows. */
export interface PastePlugin extends PluginBase {
  input: "paste";
}

/** An import plugin: one that reads a source into placement. */
export type ImportPlugin = FilePlugin | PastePlugin;

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
