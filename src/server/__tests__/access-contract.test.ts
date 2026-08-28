import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_CONTRACT } from "./access-contract";

/**
 * Holds `access-contract.ts` to the code. It infers no endpoint's access level:
 * inferring is what #108 rules out, because a grep for the guard names
 * mislabelled seven of seventeen endpoints and could not tell a correctly
 * ungated public read from a gate it failed to recognize.
 *
 * What it enforces is that the two lists name the same endpoints, so a new one
 * cannot ship without someone answering what it allows.
 */

const SRC_DIR = join(process.cwd(), "src");

/**
 * `export const <name> = createServerFn`, allowing a type annotation and a line
 * break before the initializer. Both of those shapes are legal and both were
 * invisible to the first version of this pattern, which is why the
 * reconciliation below exists rather than trust in this regex.
 */
const ENDPOINT_DECLARATION =
  /^export const (\w+)\s*(?::[^=\n]+)?=\s*createServerFn/gm;

/** Any mention of the factory, wherever it appears. */
const FACTORY_MENTION = /\bcreateServerFn\b/g;

const IMPORT_LINE = /^\s*import\b/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;

/** Test files declare no endpoints, and `node_modules` is not ours. */
const SKIP_DIRS = new Set(["__tests__", "node_modules"]);

function typeScriptFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        found.push(...typeScriptFilesUnder(full));
      }
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      found.push(full);
    }
  }
  return found;
}

/** Mentions that should correspond to a declaration: not imports, not prose. */
function factoryMentions(source: string): number {
  const code = source
    .split("\n")
    .filter((line) => !(IMPORT_LINE.test(line) || COMMENT_LINE.test(line)))
    .join("\n");
  return code.match(FACTORY_MENTION)?.length ?? 0;
}

/**
 * Every endpoint in `src`, not just `src/server`. The narrower scan missed
 * `lib/auth-guards.ts:getSession`, which is as reachable as any of the others,
 * and would have missed anything added in a subdirectory.
 */
function scanEndpoints(): { declared: string[]; mentions: number } {
  const declared: string[] = [];
  let mentions = 0;
  for (const file of typeScriptFilesUnder(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    mentions += factoryMentions(source);
    for (const match of source.matchAll(ENDPOINT_DECLARATION)) {
      declared.push(`${relative(SRC_DIR, file)}:${match[1]}`);
    }
  }
  return { declared: declared.sort(), mentions };
}

function liveEndpoints(): string[] {
  return scanEndpoints().declared;
}

function declaredAt(level: string): string[] {
  return Object.entries(ACCESS_CONTRACT)
    .filter(([, declaration]) => declaration.level === level)
    .map(([endpoint]) => endpoint)
    .sort();
}

describe("the server function access contract", () => {
  it("accounts for every use of createServerFn, not just the ones it can parse", () => {
    // The guard that makes the other assertions trustworthy, and the one this
    // file was missing. Both of the assertions below compare the declaration
    // list against ACCESS_CONTRACT, so an endpoint the regex cannot see is not
    // "undeclared", it is absent from both sides and reports nothing. Two real
    // shapes slipped through that way: a type annotation
    // (`export const x: unknown = createServerFn(...)`) and a line break before
    // the initializer.
    //
    // Counting mentions instead means any shape the pattern does not parse is a
    // failure rather than a silence. If this goes red, widen
    // ENDPOINT_DECLARATION; do not add the endpoint to an ignore list.
    const { declared, mentions } = scanEndpoints();
    expect(declared.length).toBe(mentions);
  });

  it("declares a level for every endpoint that exists", () => {
    const undeclared = liveEndpoints().filter(
      (endpoint) => !(endpoint in ACCESS_CONTRACT)
    );
    expect(undeclared).toEqual([]);
  });

  it("declares no endpoint that has been removed or renamed", () => {
    const live = new Set(liveEndpoints());
    const stale = Object.keys(ACCESS_CONTRACT).filter(
      (endpoint) => !live.has(endpoint)
    );
    expect(stale).toEqual([]);
  });

  it("keeps the public surface to exactly these endpoints", () => {
    // A speed bump rather than a check: it compares two literals and reads no
    // source, so it cannot tell you a level is wrong. What it does is make
    // widening the public surface cost a second, visible edit, on the one level
    // where a careless declaration is itself the bug. Every other value fails
    // closed when it is too generous by a step; a wrong `public` ships the data.
    //
    // If you are here because this failed, the question is whether the new
    // endpoint should be reachable with no session at all.
    expect(declaredAt("public")).toEqual([
      "lib/auth-guards.ts:getSession",
      "server/categories.ts:getCategory",
      "server/categories.ts:listCategories",
      "server/categories.ts:listCategoryTypes",
      "server/categories.ts:listProjectCategories",
      "server/inventory.ts:getInventoryItem",
      "server/inventory.ts:getInventoryItemDetail",
      "server/inventory.ts:listInventory",
      "server/inventory.ts:listInventoryCategories",
      "server/programs.ts:listPrograms",
      "server/projects-queries.ts:getProject",
      "server/projects-queries.ts:listProjectComments",
      "server/search.ts:searchProjects",
    ]);
  });
});
