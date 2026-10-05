import { z } from "zod";
import { removeFromResult } from "#/lib/placement/board";
import { type ImportIssue, normalizeTitle } from "#/lib/placement/csv";
import {
  type ReadAs,
  readAsChoice,
  uploadPlugins,
} from "#/lib/placement/plugins";
import {
  type ColumnMapping,
  columnMappingId,
  readMapping,
  versionMessage,
} from "#/lib/placement/plugins/custom-mapping";
import { repointRosterPins, rosterProjectKey } from "#/lib/placement/roster";
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
  | { kind: "pasted" }
  /** Every project added one at a time on the Projects tab (#716). */
  | { kind: "manual" };

export interface Workspace {
  bids: {
    /**
     * What converting `convertedFrom` noticed, kept by a workspace saved
     * before plugins converted on read (#733). Never written now.
     */
    conversionIssues?: ImportIssue[];
    /**
     * The survey export's own filename, in a workspace saved before plugins
     * converted on read, whose `text` is the converted CSV. Never written now.
     */
    convertedFrom?: string;
    filename: string;
    /**
     * The column mapping staff made for the file, read through while
     * `readAs` is custom mapping and kept, unused, while it is not.
     */
    mapping?: ColumnMapping;
    /** How the file is read: see `ReadAs`. Absent means detected. */
    readAs?: ReadAs;
    /** The file as it was uploaded, converted on every read. */
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
  /**
   * The column mapping staff made for a CSV, read through while `readAs` is
   * custom mapping and kept, unused, while it is not.
   */
  mapping?: ColumnMapping;
  /** How a CSV is read: see `ReadAs`. A pasted list has one way. */
  readAs?: ReadAs;
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
  addedByHand: z.boolean().optional(),
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
        z.object({ kind: z.literal("manual") }),
      ])
      .nullable(),
    projects: z.array(projectSchema),
    bids: z
      .object({
        filename: z.string(),
        text: z.string(),
        readAs: z.string().nullable().optional(),
        // Checked by `settleMappings`, which removes one it cannot read
        // rather than refusing the whole workspace.
        mapping: z.unknown().optional(),
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
        readAs: z.string().nullable().optional(),
        mapping: z.unknown().optional(),
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

/** A file the roster or the bids hold, which a column mapping can read. */
export type MappedSource = "roster" | "bids";

/**
 * A column mapping a workspace held and reading it removed (#735), for the
 * page to say so while the file it belonged to is still there unmapped.
 */
export interface MappingNotice {
  message: string;
  source: MappedSource;
  /** The file the column mapping was stored with. */
  text: string;
}

/**
 * The entry with a stored column mapping it can use, or without one it
 * cannot, and why: a mapping of another version, of another dataset, or of
 * the wrong shape. Its `readAs` goes with it, so the file is detected again.
 */
function settleMapping<
  E extends { mapping?: unknown; readAs?: ReadAs; text: string },
>(
  entry: E,
  dataset: MappedSource
): {
  entry: Omit<E, "mapping" | "readAs"> & {
    mapping?: ColumnMapping;
    readAs?: ReadAs;
  };
  notice?: Omit<MappingNotice, "source">;
} {
  const { mapping, readAs, ...base } = entry;
  const kept = readAs === undefined ? {} : { readAs };
  if (mapping === undefined) {
    return { entry: { ...base, ...kept } };
  }
  const read = readMapping(mapping);
  if (read.ok && read.mapping.dataset === dataset) {
    return { entry: { ...base, ...kept, mapping: read.mapping } };
  }
  let reason = `Its shape is wrong: ${"problem" in read ? read.problem : ""}.`;
  if (read.ok) {
    reason = `It is for the ${read.mapping.dataset}, not the ${dataset}.`;
  } else if ("version" in read) {
    reason = versionMessage(read.version);
  }
  // A file read through the mapping is detected again without it.
  const inUse = readAs === columnMappingId(dataset);
  return {
    entry: inUse ? base : { ...base, ...kept },
    notice: {
      message: `The column mapping saved with the ${dataset} could not be read, so it was removed from this workspace${inUse ? " and the file is read as detected" : ""}. ${reason} Map its columns again to read it that way.`,
      text: entry.text,
    },
  };
}

/** The workspace with every stored column mapping checked (#735). */
function settleMappings(parsed: z.infer<typeof workspaceSchema>): {
  notices: MappingNotice[];
  workspace: Workspace;
} {
  const { bids: storedBids, roster: storedRoster, ...rest } = parsed;
  const bids = storedBids && settleMapping(storedBids, "bids");
  const roster = storedRoster && settleMapping(storedRoster, "roster");
  return {
    notices: [
      ...(bids?.notice ? [{ ...bids.notice, source: "bids" as const }] : []),
      ...(roster?.notice
        ? [{ ...roster.notice, source: "roster" as const }]
        : []),
    ],
    workspace: {
      ...rest,
      bids: bids?.entry ?? null,
      ...(roster === undefined ? {} : { roster: roster.entry }),
    },
  };
}

/**
 * A workspace from an exported file or from storage, or why it is not one.
 * `notices` says what was removed to read it, when anything was.
 */
export function parseWorkspace(
  json: string
):
  | { ok: true; workspace: Workspace; notices?: MappingNotice[] }
  | { ok: false; message: string } {
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
  const { notices, workspace } = settleMappings(parsed.data);
  return notices.length > 0
    ? { ok: true, workspace, notices }
    : { ok: true, workspace };
}

/**
 * The notices still worth showing: a slot's goes once its file is gone or
 * replaced, or once staff store a new column mapping for it.
 */
export function currentNotices(
  notices: readonly MappingNotice[],
  workspace: Workspace | null
): MappingNotice[] {
  return notices.filter((n) => {
    const entry = n.source === "roster" ? workspace?.roster : workspace?.bids;
    return entry?.text === n.text && entry.mapping === undefined;
  });
}

/**
 * The workspace with the roster or bids file read as staff chose in Read
 * as. A column mapping stays stored, unused, so choosing column mapping again
 * reads through it. A choice that is not a way to read this dataset's file
 * changes nothing.
 */
export function setReadAs(
  workspace: Workspace,
  dataset: MappedSource,
  choice: string | null
): Workspace {
  if (choice !== null && !uploadPlugins(dataset).some((p) => p.id === choice)) {
    return workspace;
  }
  if (dataset === "roster") {
    const { roster } = workspace;
    return roster === undefined
      ? workspace
      : {
          ...workspace,
          roster: {
            ...roster,
            readAs: readAsChoice("roster", roster.text, choice),
          },
        };
  }
  const { bids } = workspace;
  return bids === null
    ? workspace
    : {
        ...workspace,
        bids: { ...bids, readAs: readAsChoice("bids", bids.text, choice) },
      };
}

/**
 * The workspace with the roster or bids file read through `mapping`, or as
 * it was for a column mapping of another dataset.
 */
export function setColumnMapping(
  workspace: Workspace,
  dataset: MappedSource,
  mapping: ColumnMapping
): Workspace {
  if (mapping.dataset !== dataset) {
    return workspace;
  }
  const readAs = columnMappingId(dataset);
  if (dataset === "roster") {
    const { roster } = workspace;
    return roster === undefined
      ? workspace
      : { ...workspace, roster: { ...roster, readAs, mapping } };
  }
  const { bids } = workspace;
  return bids === null
    ? workspace
    : { ...workspace, bids: { ...bids, readAs, mapping } };
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
  | { status: "ok"; workspace: Workspace; notices?: MappingNotice[] }
  | { status: "unreadable" } {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (raw === null) {
      return { status: "none" };
    }
    const parsed = parseWorkspace(raw);
    if (parsed.ok) {
      return {
        status: "ok",
        workspace: parsed.workspace,
        notices: parsed.notices,
      };
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
    // fingerprint. A detected file has no plugin id, and hashes as before.
    ...(Object.keys(matches).length > 0 ? [matches] : []),
    ...(workspace.roster === undefined
      ? []
      : [
          workspace.roster.readAs === undefined
            ? { roster: workspace.roster.text }
            : {
                roster: workspace.roster.text,
                readAs: workspace.roster.readAs,
              },
        ]),
    ...(workspace.bids?.readAs === undefined
      ? []
      : [{ bidsReadAs: workspace.bids.readAs }]),
    // Last, and only while the file is read through it, so a workspace with
    // no column mapping in use hashes as it did before they existed (#735).
    ...(workspace.roster?.mapping !== undefined &&
    workspace.roster.readAs === columnMappingId("roster")
      ? [{ rosterMapping: mappingKey(workspace.roster.mapping) }]
      : []),
    ...(workspace.bids?.mapping !== undefined &&
    workspace.bids.readAs === columnMappingId("bids")
      ? [{ bidsMapping: mappingKey(workspace.bids.mapping) }]
      : []),
  ]);
  // djb2 in plain arithmetic, kept below 2^32 so it stays exact.
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33 + text.charCodeAt(i)) % 4_294_967_296;
  }
  return `${text.length}:${hash.toString(36)}`;
}

/**
 * A column mapping in a fixed order, since the page builds one in the
 * format's column order and storage hands it back in the schema's: the same
 * mapping must hash the same either way.
 */
function mappingKey(mapping: ColumnMapping): [string, string[][]] {
  return [
    mapping.dataset,
    Object.entries(mapping.columns).sort(([a], [b]) => (a < b ? -1 : 1)),
  ];
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

const ROSTER_KEY = /^roster:\S/;

/** Every project key a run names: its placements and its diagnostics. */
function resultKeys(result: StoredResult): Set<string> {
  const d = result.diagnostics;
  return new Set([
    ...result.placements.map((p) => p.projectKey),
    ...d.projectsBelowMin,
    ...d.pinnedProjectsBelowMin,
    ...d.pinOverflow.map((o) => o.projectKey),
  ]);
}

/** The run with one project key renamed wherever it names it. */
function renameInResult(
  result: StoredResult,
  from: string,
  to: string
): StoredResult {
  const rename = (key: string) => (key === from ? to : key);
  const d = result.diagnostics;
  return {
    ...result,
    placements: result.placements.map((p) => ({
      ...p,
      projectKey: rename(p.projectKey),
    })),
    diagnostics: {
      ...d,
      projectsBelowMin: d.projectsBelowMin.map(rename),
      pinnedProjectsBelowMin: d.pinnedProjectsBelowMin.map(rename),
      pinOverflow: d.pinOverflow.map((o) => ({
        ...o,
        projectKey: rename(o.projectKey),
      })),
    },
  };
}

/**
 * The workspace with one project added by hand (#716), keyed by its
 * normalized title as a CSV project is, or the reason it cannot be: the
 * title normalizes to nothing, or a listed project already has it, whatever
 * that project's key. A project the roster added under the same title
 * becomes this one, its pins and places in the last run with it, and a title
 * matched by hand to another project gives way, since bids now name this one
 * exactly. Pins and the last run otherwise stay; the run is stale from here.
 */
export function addProject(
  workspace: Workspace,
  project: Omit<WorkspaceProject, "key" | "addedByHand" | "fromRoster">
): { ok: true; workspace: Workspace } | { ok: false; message: string } {
  const key = normalizeTitle(project.title);
  if (key === "") {
    return { ok: false, message: "Enter a title with letters or digits." };
  }
  // The roster's own projects are keyed "roster:<title>", with no space
  // after the colon; "Roster: Lab Tools" keeps its space and never collides.
  if (ROSTER_KEY.test(key)) {
    return {
      ok: false,
      message:
        'A title cannot start with "roster:" followed directly by a letter or digit; projects the roster adds are named that way.',
    };
  }
  if (
    workspace.projects.some(
      (p) => p.key === key || normalizeTitle(p.title) === key
    )
  ) {
    return {
      ok: false,
      message: "A project with this title is already in the list.",
    };
  }
  const fromRoster = rosterProjectKey(key);
  const { [key]: _matched, ...titleMatches } = workspace.titleMatches ?? {};
  return {
    ok: true,
    workspace: {
      ...workspace,
      projects: [...workspace.projects, { ...project, key, addedByHand: true }],
      projectSource:
        workspace.projects.length === 0
          ? { kind: "manual" }
          : workspace.projectSource,
      pins: repointRosterPins(workspace.pins, { [key]: { projectKey: key } }),
      titleMatches:
        Object.keys(titleMatches).length > 0 ? titleMatches : undefined,
      result:
        workspace.result && renameInResult(workspace.result, fromRoster, key),
    },
  };
}

/**
 * The workspace without one project (#716). A title matched to it by hand
 * goes too, so its bids show as unmatched again; a pin to it stays, and the
 * next run reports it as a pin to a dropped project. The last run stays and
 * reads as stale, unless it names the project, by a placement or in what it
 * says about the run: a board naming a project the list no longer has would
 * show its bare key, so that run goes.
 */
export function removeProject(workspace: Workspace, key: string): Workspace {
  const projects = workspace.projects.filter((p) => p.key !== key);
  const placedThere =
    workspace.result !== undefined && resultKeys(workspace.result).has(key);
  return {
    ...workspace,
    projects,
    projectSource: projects.length === 0 ? null : workspace.projectSource,
    titleMatches: pruneTitleMatches(workspace.titleMatches, projects),
    result: placedThere ? undefined : workspace.result,
  };
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
