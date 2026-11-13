// Shared, dependency-free definitions for the model that picks a project's
// categories (#31). Client-safe: the staff panel reads the proposal shape, the
// server builds the tool and parses the answer here. No AWS, no DB.

import { z } from "zod";
import { escapeAngleBrackets } from "./angle-brackets";
import {
  DEFAULT_CATEGORIES,
  FIELD_TYPE,
  KIND_OF_WORK_TYPE,
} from "./default-categories";

/** One live project category, as the model is shown it. */
export interface CategoryOption {
  description: string | null;
  id: string;
  name: string;
  type: string;
  /** How many published projects carry it, which breaks ties (#31). */
  usage: number;
}

/**
 * How many categories of one type a project may carry, as the model is told
 * and as its answer is checked. Over-assignment is the failure that makes a
 * filter useless, and the model is the only party still inclined to it, so the
 * caps bind the model alone: staff are not capped.
 */
export interface FacetRule {
  max: number;
  min: number;
}

export function facetRule(type: string): FacetRule {
  if (type === KIND_OF_WORK_TYPE) {
    return { min: 1, max: 1 };
  }
  if (type === FIELD_TYPE) {
    return { min: 1, max: 2 };
  }
  return { min: 0, max: 2 };
}

/** Length caps on a proposed category, the same as the staff form's. */
export const PROPOSAL_NAME_MAX_LENGTH = 100;
export const PROPOSAL_TEXT_MAX_LENGTH = 300;

/**
 * A new category the model proposes on Regenerate. Shown to staff as a
 * prefilled form, never stored until staff approve it.
 */
export interface CategoryProposal {
  description: string;
  name: string;
  reason: string;
  type: string;
}

export interface CategorizeAnswer {
  /** The chosen categories' real ids, deduplicated. */
  categoryIds: string[];
  proposal: CategoryProposal | null;
}

interface Facet {
  /** The tool's property name for this type. */
  key: string;
  options: { handle: string; option: CategoryOption }[];
  rule: FacetRule;
  type: string;
}

export interface CategorizeTool {
  /** The category list as the prompt renders it, handles included. */
  catalog: string;
  /** The `parameters` of the Responses API tool. */
  parameters: Record<string, unknown>;
  /** Turns the tool call's arguments into real ids, or throws. */
  parse: (args: unknown) => CategorizeAnswer;
}

/**
 * A type as a property name: "Kind of work" becomes `kind_of_work`. Types are
 * free text staff invent, so two can slug alike; the later one gets a suffix.
 */
function facetKeys(types: string[]): Map<string, string> {
  const keys = new Map<string, string>();
  const taken = new Set<string>(["proposal"]);
  for (const type of types) {
    const base =
      type
        .toLowerCase()
        .replace(/[^a-z0-9]+/gu, "_")
        .replace(/^_+|_+$/gu, "") || "facet";
    let key = base;
    for (let n = 2; taken.has(key); n++) {
      key = `${base}_${n}`;
    }
    taken.add(key);
    keys.set(type, key);
  }
  return keys;
}

/**
 * Kind of work first, then Field, then the rest by name, so the prompt reads
 * the way the rules do.
 */
function typeOrder(a: string, b: string): number {
  const rank = (type: string) => {
    if (type === KIND_OF_WORK_TYPE) {
      return 0;
    }
    return type === FIELD_TYPE ? 1 : 2;
  };
  return rank(a) - rank(b) || (a < b ? -1 : Number(a > b));
}

/**
 * A default category's place in the default list, so Kind of work reaches the
 * model in precedence order, Competition before Research before Existing
 * System before New Build: "the first that fits" means nothing in name order,
 * which put Research last and filed six of seven research projects as
 * something else in the 2026-11-12 trial. A category staff added sorts after the defaults by name.
 */
const DEFAULT_RANK = new Map(
  DEFAULT_CATEGORIES.map((c, i) => [`${c.type}\u{0}${c.name.toLowerCase()}`, i])
);

function optionOrder(a: CategoryOption, b: CategoryOption): number {
  const rank = (o: CategoryOption) =>
    DEFAULT_RANK.get(`${o.type}\u{0}${o.name.toLowerCase()}`) ??
    Number.POSITIVE_INFINITY;
  const byRank = rank(a) - rank(b);
  if (byRank !== 0 && !Number.isNaN(byRank)) {
    return byRank;
  }
  return a.name < b.name ? -1 : Number(a.name > b.name);
}

function ruleText(rule: FacetRule): string {
  if (rule.min === rule.max) {
    return `exactly ${rule.min}`;
  }
  return rule.min === 0 ? `at most ${rule.max}` : `${rule.min} to ${rule.max}`;
}

function catalogLine(handle: string, option: CategoryOption): string {
  const definition = option.description
    ? `: ${escapeAngleBrackets(option.description)}`
    : "";
  const used = option.usage === 1 ? "1 project" : `${option.usage} projects`;
  return `${handle} ${escapeAngleBrackets(option.name)} (${used})${definition}`;
}

/**
 * The tool that files one project, built from the live category list at call
 * time, since staff add and rename categories and invent types.
 *
 * Each type is a property holding an array of that type's handles, short
 * `c1`, `c2` stand-ins for the ids, with the type's cap as `minItems` and
 * `maxItems`, so a category that does not exist and a third pick in one type
 * are both outside the schema. The Zod parser built beside it is what
 * enforces that: the JSON schema tells the model, the parser decides.
 *
 * `allowProposal` is Regenerate's alone. Without it the tool has no field for
 * a new category at all, rather than a field the prompt asks the model to
 * leave empty. With it, `proposal` is one category or null, and its type is a
 * closed enum of the existing types other than Kind of work: a model writing
 * "tech" beside "Technology" would split one group into two with no error
 * anywhere.
 *
 * Null when the list cannot satisfy its own rules, a type with a minimum
 * holding no category at all, as on a database with no Kind of work rows.
 */
export function buildCategorizeTool(
  options: CategoryOption[],
  { allowProposal }: { allowProposal: boolean }
): CategorizeTool | null {
  const types = [...new Set(options.map((o) => o.type))].sort(typeOrder);
  for (const required of [KIND_OF_WORK_TYPE, FIELD_TYPE]) {
    if (!types.includes(required)) {
      return null;
    }
  }
  const keys = facetKeys(types);
  let next = 1;
  const facets: Facet[] = types.map((type) => ({
    type,
    key: keys.get(type) ?? type,
    rule: facetRule(type),
    options: options
      .filter((o) => o.type === type)
      .sort(optionOrder)
      .map((option) => ({ handle: `c${next++}`, option })),
  }));
  const byHandle = new Map(
    facets.flatMap((f) => f.options.map((o) => [o.handle, o.option.id]))
  );

  const properties: Record<string, unknown> = {};
  const shape: Record<string, z.ZodType> = {};
  for (const facet of facets) {
    const handles = facet.options.map((o) => o.handle);
    properties[facet.key] = {
      type: "array",
      description: `${facet.type}: ${ruleText(facet.rule)}.`,
      items: { type: "string", enum: handles },
      minItems: facet.rule.min,
      maxItems: facet.rule.max,
    };
    shape[facet.key] = z
      .array(z.enum(handles as [string, ...string[]]))
      .min(facet.rule.min)
      .max(facet.rule.max)
      .refine((picked) => new Set(picked).size === picked.length, {
        message: "A category is picked twice",
      });
  }

  const proposalTypes = types.filter((t) => t !== KIND_OF_WORK_TYPE);
  if (allowProposal) {
    properties.proposal = {
      type: ["object", "null"],
      description:
        "A new category, only when no existing one is a reasonable fit; otherwise null.",
      additionalProperties: false,
      properties: {
        name: { type: "string", maxLength: PROPOSAL_NAME_MAX_LENGTH },
        type: { type: "string", enum: proposalTypes },
        description: { type: "string", maxLength: PROPOSAL_TEXT_MAX_LENGTH },
        reason: { type: "string", maxLength: PROPOSAL_TEXT_MAX_LENGTH },
      },
      required: ["name", "type", "description", "reason"],
    };
    shape.proposal = z
      .object({
        name: z.string().trim().min(1).max(PROPOSAL_NAME_MAX_LENGTH),
        type: z.enum(proposalTypes as [string, ...string[]]),
        description: z.string().trim().min(1).max(PROPOSAL_TEXT_MAX_LENGTH),
        reason: z.string().trim().min(1).max(PROPOSAL_TEXT_MAX_LENGTH),
      })
      .strict()
      .nullable();
  }
  const schema = z.object(shape).strict();

  const catalog = facets
    .map((facet) =>
      [
        `Type: ${escapeAngleBrackets(facet.type)}, pick ${ruleText(facet.rule)}, in "${facet.key}"`,
        ...facet.options.map((o) => catalogLine(o.handle, o.option)),
      ].join("\n")
    )
    .join("\n\n");

  return {
    catalog,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties,
      required: Object.keys(properties),
    },
    parse(args) {
      const parsed = schema.parse(args) as Record<string, unknown>;
      const categoryIds = facets.flatMap((facet) =>
        (parsed[facet.key] as string[]).map(
          (handle) => byHandle.get(handle) ?? handle
        )
      );
      return {
        categoryIds,
        proposal: (parsed.proposal as CategoryProposal | null) ?? null,
      };
    },
  };
}

/** The project text the model files, the fields a proposer writes. */
export interface CategorizeSourceProject {
  description: string | null;
  minQualifications: string | null;
  objectives: string | null;
  prefQualifications: string | null;
  problemStatement: string | null;
  title: string;
}

/**
 * Model-facing tags, as in `scope-assessment-source.ts`. The qualifications
 * are in on purpose: they are where a proposal names its technologies.
 */
const SOURCE_FIELDS = [
  ["title", "Title"],
  ["description", "Description"],
  ["problemStatement", "Problem statement"],
  ["objectives", "Objectives / deliverables"],
  ["minQualifications", "Minimum qualifications"],
  ["prefQualifications", "Preferred qualifications"],
] as const;

/**
 * Every value escaped, so no proposal text can close the `<field>` it sits in
 * (#841).
 */
export function buildCategorizeSource(
  project: CategorizeSourceProject
): string {
  return SOURCE_FIELDS.flatMap(([field, label]) => {
    const value = project[field]?.trim();
    return value
      ? [`<field name="${label}">\n${escapeAngleBrackets(value)}\n</field>`]
      : [];
  }).join("\n\n");
}
