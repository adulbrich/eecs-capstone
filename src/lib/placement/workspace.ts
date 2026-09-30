import { z } from "zod";
import { removeFromResult } from "#/lib/placement/board";
import { type ImportIssue, normalizeTitle } from "#/lib/placement/csv";
import {
  DEFAULT_PLACEMENT_PARAMETERS,
  type PlacementInput,
  type PlacementParameters,
  type PlacementResult,
  type PlacementStudent,
  type ProjectContact,
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
  | { kind: "csv"; filename: string }
  | { kind: "pasted" };

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
  /**
   * Pins set on the results board, by email: a project key pins the student
   * there, null unpins them, overriding the bids file either way.
   */
  pins?: Record<string, string | null>;
  projectSource: ProjectSource | null;
  projects: WorkspaceProject[];
  /**
   * Emails of the students staff took out of placement by hand (#679), such
   * as one who transferred sections. Kept by email like `pins`, so a removal
   * outlasts new bids or a new roster.
   */
  removed?: string[];
  /** The last run that produced a placement. */
  result?: StoredResult;
  /**
   * The class roster (#665), as the file or the pasted text it came as,
   * parsed on read like the bids.
   */
  roster?: StoredRoster;
  /**
   * Bid titles staff matched to a project by hand (#661), keyed by the
   * normalized bid title. Applied when the bids are parsed, so the file
   * itself is never rewritten.
   */
  titleMatches?: TitleMatches;
  version: 1;
}

export type TitleMatches = Record<string, TitleMatch>;

export interface StoredRoster {
  source: { kind: "csv"; filename: string } | { kind: "pasted" };
  text: string;
}

export interface TitleMatch {
  projectKey: string;
  /** The bid title as the file spells it, for the list of matches. */
  title: string;
}

export type StoredResult = PlacementResult & {
  /** When the run finished, as an ISO timestamp. */
  at: string;
  /** Set once a Move has changed the placement by hand since the run. */
  edited?: boolean;
  /** `inputFingerprint` of the workspace the run read. */
  fingerprint: string;
};

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
  mentorEmail: z.string().optional(),
  mentorName: z.string().optional(),
  proposerEmail: z.string().optional(),
  proposerName: z.string().optional(),
  studentProposed: z.boolean().optional(),
});

const resultSchema = z.object({
  at: z.string(),
  fingerprint: z.string(),
  edited: z.boolean().optional(),
  status: z.enum(["optimal", "time_limit", "infeasible", "error"]),
  placements: z.array(
    z.object({
      email: z.string(),
      projectKey: z.string(),
      team: z.number().int(),
      priority: z.number().int().nullable(),
    })
  ),
  unplaced: z.array(
    z.object({
      email: z.string(),
      reason: z.enum(["no_eligible_project", "pinned_to_dropped_project"]),
    })
  ),
  gap: z.number().nullable(),
  objective: z.number().nullable(),
  message: z.string().optional(),
  diagnostics: z.object({
    pinnedProjectsBelowMin: z.array(z.string()),
    pinOverflow: z.array(
      z.object({
        projectKey: z.string(),
        pinned: z.number(),
        seats: z.number(),
      })
    ),
    projectsBelowMin: z.array(z.string()),
    requiredSeatShortfall: z
      .object({ required: z.number(), students: z.number() })
      .nullable(),
    seatShortfall: z
      .object({ students: z.number(), seats: z.number() })
      .nullable(),
  }),
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
        z.object({ kind: z.literal("pasted") }),
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
              wholeFile: z.boolean().optional(),
            })
          )
          .optional(),
      })
      .nullable(),
    pins: z.record(z.string(), z.string().nullable()).optional(),
    // Lowercase, as every parser writes an email, so a hand-edited file
    // still removes the student it names.
    removed: z.array(z.string().toLowerCase()).optional(),
    result: resultSchema.optional(),
    roster: z
      .object({
        source: z.discriminatedUnion("kind", [
          z.object({ kind: z.literal("csv"), filename: z.string() }),
          z.object({ kind: z.literal("pasted") }),
        ]),
        text: z.string(),
      })
      .optional(),
    titleMatches: z
      .record(
        z.string(),
        z.object({ projectKey: z.string(), title: z.string() })
      )
      .optional(),
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
    workspace.roster === undefined &&
    (workspace.removed ?? []).length === 0 &&
    Object.entries(DEFAULT_WORKSPACE_PARAMETERS).every(
      ([key, value]) =>
        JSON.stringify(parameters[key]) === JSON.stringify(value)
    )
  );
}

/** What a run hands the solver: page defaults filled into every project. */
export function toPlacementInput(
  workspace: Workspace,
  students: PlacementStudent[],
  projects: readonly WorkspaceProject[]
): PlacementInput {
  const { maxTeams, ...parameters } = workspace.parameters;
  return {
    projects: projects.map((p) => ({
      ...withoutContact(p),
      maxTeams: p.maxTeams ?? maxTeams,
    })),
    students,
    parameters,
  };
}

/**
 * Every contact field. A record over the keys rather than a list, so a field
 * added to `ProjectContact` fails to compile here until it is named, instead
 * of reaching the fingerprint and marking every saved run stale.
 */
const CONTACT_FIELDS: Record<keyof ProjectContact, true> = {
  mentorEmail: true,
  mentorName: true,
  proposerEmail: true,
  proposerName: true,
  studentProposed: true,
};

/** A project with its contact fields dropped: what a run reads of it. */
export function withoutContact<P extends WorkspaceProject>(
  project: P
): Omit<P, keyof ProjectContact> {
  return Object.fromEntries(
    Object.entries(project).filter(
      ([key]) => !Object.hasOwn(CONTACT_FIELDS, key)
    )
  ) as Omit<P, keyof ProjectContact>;
}

/**
 * Who staff ask about a project (#715): the mentor for a student-proposed
 * one, the proposer otherwise, and the other of the two when that one is
 * missing. Null when the project names nobody.
 */
export function contactFor(
  project: ProjectContact
): { email?: string; name?: string; role: "mentor" | "proposer" } | null {
  // A blank string, as a hand-edited workspace file can hold, is no name.
  const mentor = {
    email: optionalText(project.mentorEmail),
    name: optionalText(project.mentorName),
    role: "mentor" as const,
  };
  const proposer = {
    email: optionalText(project.proposerEmail),
    name: optionalText(project.proposerName),
    role: "proposer" as const,
  };
  const order = project.studentProposed
    ? [mentor, proposer]
    : [proposer, mentor];
  return order.find((c) => c.email || c.name) ?? null;
}

/** Trimmed, or undefined when blank or missing. */
const optionalText = (value: string | null | undefined) =>
  value?.trim() || undefined;

/**
 * Published projects from the portal, keyed by id. Two with the same title
 * would leave a bid unable to say which one it means, so the second is
 * reported and a bid naming that title goes to the first. The proposer
 * falls back to the project's contact, which a project proposed before the
 * proposer had an account may be all it has.
 */
export function projectsFromPortal(
  rows: readonly {
    contactEmail?: string | null;
    contactName?: string | null;
    id: string;
    mentorEmail?: string | null;
    mentorName?: string | null;
    proposerEmail?: string | null;
    proposerName?: string | null;
    studentProposed?: boolean | null;
    teamsSupported: number;
    title: string;
  }[]
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
    projects: rows.map((row) => {
      const hasProposer = Boolean(
        optionalText(row.proposerName) || optionalText(row.proposerEmail)
      );
      return {
        key: row.id,
        title: row.title,
        maxTeams: row.teamsSupported,
        weightMultiplier: 1,
        mentorEmail: optionalText(row.mentorEmail),
        mentorName: optionalText(row.mentorName),
        proposerEmail: optionalText(
          hasProposer ? row.proposerEmail : row.contactEmail
        ),
        proposerName: optionalText(
          hasProposer ? row.proposerName : row.contactName
        ),
        studentProposed: row.studentProposed === true || undefined,
      };
    }),
  };
}

/**
 * What a run depended on, as a short string: the projects with their
 * settings, the parameters, the bids file, the title matches and the
 * roster. Pins are left out on purpose, so approving a student does not
 * mark the run it came from as stale. `titleMatches` and `roster` are
 * required, even as undefined, so a caller cannot forget one and hash a
 * different input from every other caller.
 */
export function inputFingerprint(
  workspace: Pick<Workspace, "bids" | "parameters" | "projects"> & {
    roster: Workspace["roster"];
    titleMatches: Workspace["titleMatches"];
  }
): string {
  const matches = workspace.titleMatches ?? {};
  const text = JSON.stringify([
    // Without who to contact, which no run reads: loading it must not mark
    // a run stale, and a project without it hashes as it always did.
    workspace.projects.map(withoutContact),
    workspace.parameters,
    workspace.bids?.text ?? null,
    // Each only when present, so a run stored before it existed keeps its
    // fingerprint.
    ...(Object.keys(matches).length > 0 ? [matches] : []),
    ...(workspace.roster === undefined
      ? []
      : [{ roster: workspace.roster.text }]),
  ]);
  // djb2 in plain arithmetic, kept below 2^32 so it stays exact.
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33 + text.charCodeAt(i)) % 4_294_967_296;
  }
  return `${text.length}:${hash.toString(36)}`;
}

/**
 * Whether the projects, parameters or bids changed since `result` ran,
 * given `inputFingerprint` of the workspace now. False with no result.
 */
export function isStale(
  result: StoredResult | undefined,
  fingerprint: string
): boolean {
  return result !== undefined && result.fingerprint !== fingerprint;
}

/**
 * The title matches that still name a project, for when a new project list
 * loads: a match to a project that left falls away, and its title shows as
 * unmatched again.
 */
export function pruneTitleMatches(
  matches: TitleMatches | undefined,
  projects: readonly Pick<WorkspaceProject, "key">[]
): TitleMatches | undefined {
  if (matches === undefined) {
    return;
  }
  const keys = new Set(projects.map((p) => p.key));
  const kept = Object.entries(matches).filter(([, m]) =>
    keys.has(m.projectKey)
  );
  return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}

/**
 * The workspace with `emails` taken out of placement (#679). A placement
 * shown on the board loses them at once, as a Move edits it, and is marked
 * edited. Their pins stay, and a restore brings the pins back too.
 */
export function removeStudents(
  workspace: Workspace,
  emails: readonly string[]
): Workspace {
  const removed = new Set([...(workspace.removed ?? []), ...emails]);
  return {
    ...workspace,
    removed: [...removed].sort(),
    result: workspace.result && removeFromResult(workspace.result, emails),
  };
}

export interface RemovedStudent {
  email: string;
  /** False when neither the bids nor the roster lists the email any more. */
  listed: boolean;
  name: string;
}

/**
 * The students still in placement, and every removed email with the name
 * the bids or the roster give it.
 */
export function setAsideRemoved(
  students: readonly PlacementStudent[],
  removed: readonly string[] | undefined
): { kept: PlacementStudent[]; removed: RemovedStudent[] } {
  if (removed === undefined || removed.length === 0) {
    return { kept: [...students], removed: [] };
  }
  const gone = new Set(removed);
  const byEmail = new Map(students.map((s) => [s.email, s]));
  return {
    kept: students.filter((s) => !gone.has(s.email)),
    removed: removed.map((email) => {
      const student = byEmail.get(email);
      return {
        email,
        name: student?.name ?? "",
        listed: student !== undefined,
      };
    }),
  };
}

/** The workspace with `email` back in placement, for the next run. */
export function restoreStudent(workspace: Workspace, email: string): Workspace {
  const removed = (workspace.removed ?? []).filter((e) => e !== email);
  return { ...workspace, removed: removed.length > 0 ? removed : undefined };
}
