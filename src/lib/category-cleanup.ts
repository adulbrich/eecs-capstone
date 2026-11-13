// Shared, dependency-free definitions for the category cleanup (#857): staff
// ask a model to propose merges, renames, moves and retirements across the
// project category list, review each with its effect, and apply the ones they
// pick. Client-safe: the review list reads the shapes and the effect wording,
// the server builds the tool and parses the answer here. No AWS, no DB.

import { z } from "zod";
import { escapeAngleBrackets } from "./angle-brackets";
import { typeOrder } from "./categorize";
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  KIND_OF_WORK_TYPE,
} from "./default-categories";

/** One project category as the model is shown it. */
export interface CleanupCategory {
  createdAt: Date;
  description: string | null;
  id: string;
  name: string;
  /** Published projects carrying it, the categorizer's tie-breaker (#31). */
  publishedUsage: number;
  /** Up to five titles of published projects carrying it. */
  sampleTitles: string[];
  type: string;
  /** Non-draft projects carrying it, the admin table's Projects column. */
  usage: number;
}

/**
 * A category as the proposal saw it. Apply compares all four fields with the
 * row it finds and refuses on any difference, so a hand edit made after the
 * proposal is never overwritten by it.
 */
export interface CleanupCategoryRef {
  description: string | null;
  id: string;
  name: string;
  type: string;
}

export type CleanupOperation =
  | {
      kind: "merge";
      reason: string;
      sources: CleanupCategoryRef[];
      target: CleanupCategoryRef;
    }
  | {
      category: CleanupCategoryRef;
      /** Null keeps the current description. */
      description: string | null;
      kind: "rename";
      /** Null keeps the current name. */
      name: string | null;
      reason: string;
    }
  | {
      category: CleanupCategoryRef;
      kind: "move";
      reason: string;
      type: string;
    }
  | { category: CleanupCategoryRef; kind: "retire"; reason: string };

export type CleanupKind = CleanupOperation["kind"];

type WithoutReason<T> = T extends unknown ? Omit<T, "reason"> : never;

/** A change as apply takes it: the operation, less the model's reason. */
export type CleanupChange = WithoutReason<CleanupOperation>;

/** What applying one change did, with the sentence staff read if refused. */
export type CleanupApplyResult = { ok: true } | { ok: false; reason: string };

/** The same caps the staff form puts on a category. */
export const CLEANUP_NAME_MAX_LENGTH = 100;
export const CLEANUP_REASON_MAX_LENGTH = 300;

/**
 * Enough for a list of sixty-odd categories that has drifted for a few terms;
 * a longer answer is a model rewriting the list rather than tidying it.
 */
export const CLEANUP_MAX_OPERATIONS = 30;
export const CLEANUP_MAX_MERGE_SOURCES = 10;

/** How many sample titles the model sees per category. */
export const CLEANUP_SAMPLE_TITLES = 5;

export interface CleanupTool {
  /** The category list as the prompt renders it, handles included. */
  catalog: string;
  /** The `parameters` of the Responses API tool. */
  parameters: Record<string, unknown>;
  /**
   * Turns the tool call's arguments into operations on real ids. Throws on an
   * answer outside the schema; drops, and counts, an operation inside it that
   * breaks a rule the schema cannot express.
   */
  parse: (args: unknown) => { dropped: number; operations: CleanupOperation[] };
}

function ref(category: CleanupCategory): CleanupCategoryRef {
  return {
    id: category.id,
    name: category.name,
    type: category.type,
    description: category.description,
  };
}

/** Collapses whitespace so a title cannot add lines to the catalog. */
function oneLine(text: string): string {
  return escapeAngleBrackets(text.replace(/\s+/gu, " ").trim());
}

function plural(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function catalogLines(handle: string | null, c: CleanupCategory): string[] {
  const titles = c.sampleTitles.map((t) => `"${oneLine(t)}"`).join("; ");
  return [
    `${handle ? `${handle} ` : ""}${oneLine(c.name)}`,
    `  definition: ${c.description ? oneLine(c.description) : "none"}`,
    `  ${c.publishedUsage} published, ${c.usage} submitted or later, created ${c.createdAt.toISOString().slice(0, 10)}`,
    `  published titles: ${titles || "none"}`,
  ];
}

const reasonSchema = z.string().trim().min(1).max(CLEANUP_REASON_MAX_LENGTH);

function nullableText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((v) => v || null);
}

/**
 * The tool for one cleanup, built from the live list at call time.
 *
 * Four arrays, one per kind of change, over short `c1`, `c2` handles for the
 * ids, the shape the categorizer's per-facet arrays already run under
 * `strict`. Kind of work is in the catalog, so the model judges the other
 * types against it, but its categories get no handle and its type is in no
 * enum: no change can name one or move one into it. There is no field for a
 * new category or a split.
 *
 * The JSON schema tells the model; the Zod parser decides. What the schema
 * cannot say, a merge across types, a target among its own sources, a change
 * that changes nothing, a category in two changes, is checked per operation,
 * and an operation that breaks it is dropped rather than failing a paid call
 * whose other proposals are sound. One category per change keeps each one
 * applicable on its own, in any order: apply refuses a category that differs
 * from what the proposal saw, so a second change to it would always refuse.
 *
 * Null when no category can be changed at all.
 */
export function buildCleanupTool(
  categories: CleanupCategory[]
): CleanupTool | null {
  const types = [...new Set(categories.map((c) => c.type))].sort(typeOrder);
  const sorted = [...categories].sort(
    (a, b) =>
      typeOrder(a.type, b.type) ||
      (a.name < b.name ? -1 : Number(a.name > b.name))
  );
  let next = 1;
  const handles = new Map<string, string>();
  for (const c of sorted) {
    if (c.type !== KIND_OF_WORK_TYPE) {
      handles.set(c.id, `c${next++}`);
    }
  }
  if (handles.size === 0) {
    return null;
  }
  const byHandle = new Map(
    sorted.flatMap((c) => {
      const handle = handles.get(c.id);
      return handle ? [[handle, c] as const] : [];
    })
  );
  const handleList = [...byHandle.keys()] as [string, ...string[]];
  const moveTypes = types.filter((t) => t !== KIND_OF_WORK_TYPE) as [
    string,
    ...string[],
  ];

  const handleEnum = { type: "string", enum: handleList };
  const reason = { type: "string", maxLength: CLEANUP_REASON_MAX_LENGTH };
  const list = (properties: Record<string, unknown>) => ({
    type: "array",
    maxItems: CLEANUP_MAX_OPERATIONS,
    items: {
      type: "object",
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    },
  });
  const parameters = {
    type: "object",
    additionalProperties: false,
    properties: {
      merges: list({
        sources: {
          type: "array",
          items: handleEnum,
          minItems: 1,
          maxItems: CLEANUP_MAX_MERGE_SOURCES,
        },
        target: handleEnum,
        reason,
      }),
      renames: list({
        category: handleEnum,
        name: { type: ["string", "null"], maxLength: CLEANUP_NAME_MAX_LENGTH },
        description: {
          type: ["string", "null"],
          maxLength: CATEGORY_DESCRIPTION_MAX_LENGTH,
        },
        reason,
      }),
      moves: list({
        category: handleEnum,
        type: { type: "string", enum: moveTypes },
        reason,
      }),
      retires: list({ category: handleEnum, reason }),
    },
    required: ["merges", "renames", "moves", "retires"],
  };

  const handle = z.enum(handleList);
  const entries = <T extends z.ZodRawShape>(shape: T) =>
    z.array(z.object(shape).strict()).max(CLEANUP_MAX_OPERATIONS);
  const schema = z
    .object({
      merges: entries({
        sources: z.array(handle).min(1).max(CLEANUP_MAX_MERGE_SOURCES),
        target: handle,
        reason: reasonSchema,
      }),
      renames: entries({
        category: handle,
        name: nullableText(CLEANUP_NAME_MAX_LENGTH),
        description: nullableText(CATEGORY_DESCRIPTION_MAX_LENGTH),
        reason: reasonSchema,
      }),
      moves: entries({
        category: handle,
        type: z.enum(moveTypes),
        reason: reasonSchema,
      }),
      retires: entries({ category: handle, reason: reasonSchema }),
    })
    .strict();

  const catalog = types
    .map((type) => {
      const members = sorted.filter((c) => c.type === type);
      const fixed =
        type === KIND_OF_WORK_TYPE
          ? ", fixed: shown for context, no change may touch it"
          : "";
      return [
        `Type: ${oneLine(type)}, ${plural(members.length, "category")}${fixed}`,
        ...members.flatMap((c) => catalogLines(handles.get(c.id) ?? null, c)),
      ].join("\n");
    })
    .join("\n\n");

  return {
    catalog,
    parameters,
    parse(args) {
      const parsed = schema.parse(args);
      const pick = (h: string) => byHandle.get(h) as CleanupCategory;
      return onePerCategory([
        ...parsed.merges.map((m) => mergeCandidate(m, pick)),
        ...parsed.renames.map((r) => renameCandidate(r, pick)),
        ...parsed.moves.map((m) => moveCandidate(m, pick)),
        ...parsed.retires.map((r) => retireCandidate(r, pick)),
      ]);
    },
  };
}

/** An operation the parser built, with every category it names. */
interface Candidate {
  involved: CleanupCategory[];
  operation: CleanupOperation;
}

type Pick = (handle: string) => CleanupCategory;

/** Null for a repeated source, a target among its sources, or two types. */
function mergeCandidate(
  m: { reason: string; sources: string[]; target: string },
  pick: Pick
): Candidate | null {
  const target = pick(m.target);
  const sources = [...new Set(m.sources)].map(pick);
  if (
    sources.length !== m.sources.length ||
    sources.some((s) => s.id === target.id || s.type !== target.type)
  ) {
    return null;
  }
  return {
    involved: [target, ...sources],
    operation: {
      kind: "merge",
      target: ref(target),
      sources: sources.map(ref),
      reason: m.reason,
    },
  };
}

/** Null when neither the name nor the description would change. */
function renameCandidate(
  r: {
    category: string;
    description: string | null;
    name: string | null;
    reason: string;
  },
  pick: Pick
): Candidate | null {
  const category = pick(r.category);
  const name = r.name === category.name ? null : r.name;
  const description =
    r.description === category.description ? null : r.description;
  if (!(name || description)) {
    return null;
  }
  return {
    involved: [category],
    operation: {
      kind: "rename",
      category: ref(category),
      name,
      description,
      reason: r.reason,
    },
  };
}

/** Null for a move to the type the category is already in. */
function moveCandidate(
  m: { category: string; reason: string; type: string },
  pick: Pick
): Candidate | null {
  const category = pick(m.category);
  if (m.type === category.type) {
    return null;
  }
  return {
    involved: [category],
    operation: {
      kind: "move",
      category: ref(category),
      type: m.type,
      reason: m.reason,
    },
  };
}

function retireCandidate(
  r: { category: string; reason: string },
  pick: Pick
): Candidate {
  const category = pick(r.category);
  return {
    involved: [category],
    operation: { kind: "retire", category: ref(category), reason: r.reason },
  };
}

/**
 * Keeps the first change to each category, in merges, renames, moves,
 * retires order, up to the cap, and counts everything it left out.
 */
function onePerCategory(candidates: (Candidate | null)[]): {
  dropped: number;
  operations: CleanupOperation[];
} {
  const used = new Set<string>();
  const operations: CleanupOperation[] = [];
  for (const candidate of candidates) {
    if (
      !candidate ||
      operations.length >= CLEANUP_MAX_OPERATIONS ||
      candidate.involved.some((c) => used.has(c.id))
    ) {
      continue;
    }
    for (const c of candidate.involved) {
      used.add(c.id);
    }
    operations.push(candidate.operation);
  }
  return { operations, dropped: candidates.length - operations.length };
}

/**
 * Counts read when the proposal was made, from the admin table's population:
 * non-draft projects that are not deleted.
 */
export type CleanupEffect =
  | {
      kind: "merge";
      /** Distinct projects carrying the target after the merge. */
      after: number;
      /** Projects that carried more than one of the merged categories. */
      shared: number;
      sourceUsage: number[];
      targetUsage: number;
    }
  | { kind: "rename" | "move" | "retire"; usage: number };

export interface CleanupProposal {
  effect: CleanupEffect;
  operation: CleanupOperation;
}

function projects(n: number): string {
  return plural(n, "project");
}

function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names.join("");
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The one-line effect staff read before they pick, for example "Merge VR (3)
 * into AR / VR (6): 8 projects after, 1 already carried both".
 */
export function describeCleanup({
  operation,
  effect,
}: CleanupProposal): string {
  const usage = "usage" in effect ? effect.usage : 0;
  switch (operation.kind) {
    case "merge": {
      if (effect.kind !== "merge") {
        return "";
      }
      const sources = joinNames(
        operation.sources.map(
          (s, i) => `${s.name} (${effect.sourceUsage[i] ?? 0})`
        )
      );
      const both = operation.sources.length === 1 ? "both" : "more than one";
      const shared =
        effect.shared > 0 ? `, ${effect.shared} already carried ${both}` : "";
      return `Merge ${sources} into ${operation.target.name} (${effect.targetUsage}): ${projects(effect.after)} after${shared}`;
    }
    case "rename": {
      const { category, name, description } = operation;
      const count = ` (${projects(usage)})`;
      if (name && description) {
        return `Rename ${category.name} to ${name} and rewrite its description${count}`;
      }
      if (name) {
        return `Rename ${category.name} to ${name}${count}`;
      }
      return `Rewrite the description of ${category.name}${count}`;
    }
    case "move":
      return `Move ${operation.category.name} (${usage}) from ${operation.category.type} to ${operation.type}`;
    case "retire":
      return `Retire ${operation.category.name}: ${usage === 1 ? "1 project loses it" : `${projects(usage)} lose it`}`;
    default:
      return "";
  }
}

/** Every category an operation names, target first. */
export function cleanupCategories(op: CleanupChange): CleanupCategoryRef[] {
  return op.kind === "merge" ? [op.target, ...op.sources] : [op.category];
}
