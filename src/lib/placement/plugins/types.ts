import type { ImportIssue } from "#/lib/placement/csv";
import type { PlacementDataset } from "#/lib/placement/formats";
import type { WorkspaceProject } from "#/lib/placement/types";

/**
 * A placement plugin reads one source's own shape and writes the dataset's
 * standard CSV (`STANDARD_FORMATS`), which the one parser per dataset then
 * reads (ADR-0059). Plugins are modules in this folder, registered in
 * `index.ts` by a pull request; nothing is uploaded or loaded at run time.
 * `docs/placement-plugins.md` says how to write one.
 */

/** What a plugin may read besides the text. */
export interface PluginContext {
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
  /** The source's name in the UI, as in "Converted from the <label> x.csv". */
  label: string;
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

/** Text pasted into a box on the page; issues name lines, not rows. */
export interface PastePlugin extends PluginBase {
  input: "paste";
}

export type PlacementPlugin = FilePlugin | PastePlugin;
