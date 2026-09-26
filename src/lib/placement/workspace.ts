import { z } from "zod";
import { type ImportIssue, normalizeTitle } from "#/lib/placement/csv";
import {
  DEFAULT_PLACEMENT_PARAMETERS,
  type PlacementInput,
  type PlacementParameters,
  type PlacementStudent,
  type WorkspaceProject,
} from "#/lib/placement/types";

/**
 * Everything the placement page knows, kept in one localStorage key in the
 * staff member's browser and nowhere else (ADR-0056). The bids stay as the
 * file's own text and are parsed on read, because replacing the projects
 * has to re-match every bid by title, and a parsed bid has already lost it.
 */

export const WORKSPACE_STORAGE_KEY = "cs-capstone:placement:v1";

export interface WorkspaceParameters extends PlacementParameters {
  /** The ceiling for a project that sets none of its own. */
  maxTeams: number;
}

export type ProjectSource =
  | { kind: "portal"; programId: string; programLabel: string }
  | { kind: "csv"; filename: string };

export interface Workspace {
  bids: {
    /** What the conversion from a survey export noticed, kept with it. */
    conversionIssues?: ImportIssue[];
    /** The survey export's own filename, when `text` was converted from it. */
    convertedFrom?: string;
    filename: string;
    text: string;
  } | null;
  parameters: WorkspaceParameters;
  projectSource: ProjectSource | null;
  projects: WorkspaceProject[];
  version: 1;
}

export const DEFAULT_WORKSPACE_PARAMETERS: WorkspaceParameters = {
  ...DEFAULT_PLACEMENT_PARAMETERS,
  maxTeams: 1,
};

export const EMPTY_WORKSPACE: Workspace = {
  version: 1,
  projectSource: null,
  projects: [],
  bids: null,
  parameters: DEFAULT_WORKSPACE_PARAMETERS,
};

/** The bounds the parameters panel enforces, so an import cannot skip them. */
export const PARAMETER_LIMITS = {
  students: { min: 1, max: 20 },
  maxTeams: { min: 0, max: 10 },
  weight: { min: 0, max: 1000 },
  multiplier: { min: 0, max: 10 },
  timeLimitSeconds: { min: 1, max: 600 },
} as const;

const count = (limits: { min: number; max: number }) =>
  z.number().int().min(limits.min).max(limits.max);

const projectSchema = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  maxTeams: count(PARAMETER_LIMITS.maxTeams).optional(),
  minStudents: count(PARAMETER_LIMITS.students).optional(),
  maxStudents: count(PARAMETER_LIMITS.students).optional(),
  weightMultiplier: z
    .number()
    .min(PARAMETER_LIMITS.multiplier.min)
    .max(PARAMETER_LIMITS.multiplier.max),
});

const workspaceSchema = z
  .object({
    version: z.literal(1),
    projectSource: z
      .discriminatedUnion("kind", [
        z.object({
          kind: z.literal("portal"),
          programId: z.string(),
          programLabel: z.string(),
        }),
        z.object({ kind: z.literal("csv"), filename: z.string() }),
      ])
      .nullable(),
    projects: z.array(projectSchema),
    bids: z
      .object({
        filename: z.string(),
        text: z.string(),
        convertedFrom: z.string().optional(),
        conversionIssues: z
          .array(
            z.object({
              level: z.enum(["error", "warning"]),
              message: z.string(),
              row: z.number().int(),
              rows: z.array(z.number().int()).optional(),
            })
          )
          .optional(),
      })
      .nullable(),
    parameters: z.object({
      rankWeights: z
        .array(
          z
            .number()
            .min(PARAMETER_LIMITS.weight.min)
            .max(PARAMETER_LIMITS.weight.max)
        )
        .max(20),
      minStudents: count(PARAMETER_LIMITS.students),
      maxStudents: count(PARAMETER_LIMITS.students),
      maxTeams: count(PARAMETER_LIMITS.maxTeams),
      allowUnranked: z.boolean(),
      requireOneTeamPerProject: z.boolean(),
      timeLimitSeconds: z
        .number()
        .min(PARAMETER_LIMITS.timeLimitSeconds.min)
        .max(PARAMETER_LIMITS.timeLimitSeconds.max),
    }),
  })
  .refine((w) => w.parameters.minStudents <= w.parameters.maxStudents, {
    message: "The minimum team size is above the maximum.",
  })
  .refine(
    (w) => new Set(w.projects.map((p) => p.key)).size === w.projects.length,
    {
      message: "Two projects share a key.",
    }
  );

/** A workspace from an exported file or from storage, or why it is not one. */
export function parseWorkspace(
  json: string
): { ok: true; workspace: Workspace } | { ok: false; message: string } {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return { ok: false, message: "The file is not JSON." };
  }
  const parsed = workspaceSchema.safeParse(value);
  if (!parsed.success) {
    return {
      ok: false,
      message: `The file is not a placement workspace: ${parsed.error.issues[0]?.message ?? "unknown problem"}.`,
    };
  }
  return { ok: true, workspace: parsed.data };
}

export function serializeWorkspace(workspace: Workspace): string {
  return JSON.stringify(workspace, null, 2);
}

// Storage can throw (a private window, a full quota, a browser that blocks
// it), and a workspace that cannot be saved must still work for the visit.

/**
 * Where an unreadable saved workspace is moved, rather than overwritten: one
 * key per copy, stamped with when it was moved, so a second unreadable copy
 * cannot replace the first.
 */
export const UNREADABLE_WORKSPACE_PREFIX = `${WORKSPACE_STORAGE_KEY}:unreadable:`;

/**
 * The saved workspace, or none. One that no longer parses (a later schema,
 * a hand edit) is copied aside under `UNREADABLE_WORKSPACE_PREFIX` before the
 * page starts empty, because the page's next save would otherwise replace
 * it and lose every bid in it.
 */
export function readStoredWorkspace():
  | { status: "none" }
  | { status: "ok"; workspace: Workspace }
  | { status: "unreadable" } {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw === null) {
      return { status: "none" };
    }
    const parsed = parseWorkspace(raw);
    if (parsed.ok) {
      return { status: "ok", workspace: parsed.workspace };
    }
    window.localStorage.setItem(
      `${UNREADABLE_WORKSPACE_PREFIX}${new Date().toISOString()}`,
      raw
    );
    return { status: "unreadable" };
  } catch {
    return { status: "none" };
  }
}

/** False when the browser refused the write. */
export function writeStoredWorkspace(workspace: Workspace): boolean {
  try {
    window.localStorage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify(workspace)
    );
    return true;
  } catch {
    return false;
  }
}

export function clearStoredWorkspace() {
  try {
    window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // Nothing to do: the page resets its own state either way.
  }
}

/**
 * Nothing worth confirming before it is replaced: no projects, no bids, and
 * the parameters as they start.
 */
export function isEmptyWorkspace(workspace: Workspace): boolean {
  // Field by field, not one stringify: a parsed workspace carries its
  // parameters in the schema's key order, not the default's.
  const parameters = workspace.parameters as unknown as Record<string, unknown>;
  return (
    workspace.projects.length === 0 &&
    workspace.bids === null &&
    Object.entries(DEFAULT_WORKSPACE_PARAMETERS).every(
      ([key, value]) =>
        JSON.stringify(parameters[key]) === JSON.stringify(value)
    )
  );
}

/** What a run hands the solver: page defaults filled into every project. */
export function toPlacementInput(
  workspace: Workspace,
  students: PlacementStudent[]
): PlacementInput {
  const { maxTeams, ...parameters } = workspace.parameters;
  return {
    projects: workspace.projects.map((p) => ({
      ...p,
      maxTeams: p.maxTeams ?? maxTeams,
    })),
    students,
    parameters,
  };
}

/**
 * Published projects from the portal, keyed by id. Two with the same title
 * would leave a bid unable to say which one it means, so the second is
 * reported and a bid naming that title goes to the first.
 */
export function projectsFromPortal(
  rows: readonly { id: string; teamsSupported: number; title: string }[]
): { duplicates: string[]; projects: WorkspaceProject[] } {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const row of rows) {
    const title = normalizeTitle(row.title);
    if (seen.has(title)) {
      duplicates.push(row.title);
    }
    seen.add(title);
  }
  return {
    duplicates,
    projects: rows.map((row) => ({
      key: row.id,
      title: row.title,
      maxTeams: row.teamsSupported,
      weightMultiplier: 1,
    })),
  };
}
