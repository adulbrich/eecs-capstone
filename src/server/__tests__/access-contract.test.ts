import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCESS_CONTRACT } from "./access-contract";

/**
 * Holds `access-contract.ts` to the code. It infers no endpoint's access level:
 * inferring is what #108 rules out, because a grep for the guard names
 * mislabelled seven of seventeen endpoints and could not tell a correctly
 * ungated public read from a gate it failed to recognise.
 *
 * What it enforces is that the two lists agree, so a new endpoint cannot ship
 * without someone answering what it allows, plus one assertion on the declared
 * levels themselves. See the `public` case below for why only that one.
 */

const SRC_DIR = join(process.cwd(), "src");

/**
 * `^export const <name> = createServerFn`. Anchored to the line start on
 * purpose, and safe to anchor: `docs/QUIRKS.md` records that TanStack Start's
 * bundler transform recognises `createServerFn` only as the direct initializer
 * of a top-level exported const, and ships the handler body to the browser in
 * any other shape. So the framework itself rejects the declarations this would
 * miss.
 */
const SERVER_FN = /^export const (\w+) = createServerFn/gm;

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

/**
 * Every endpoint in `src`, not just `src/server`. The narrower scan missed
 * `lib/auth-guards.ts:getSession`, which is as reachable as any of the others,
 * and would have missed anything added in a subdirectory.
 */
function liveEndpoints(): string[] {
  const found: string[] = [];
  for (const file of typeScriptFilesUnder(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(SERVER_FN)) {
      found.push(`${relative(SRC_DIR, file)}:${match[1]}`);
    }
  }
  return found.sort();
}

function declaredAt(level: string): string[] {
  return Object.entries(ACCESS_CONTRACT)
    .filter(([, declaration]) => declaration.level === level)
    .map(([endpoint]) => endpoint)
    .sort();
}

describe("the server function access contract", () => {
  it("declares a level for every endpoint that exists", () => {
    const undeclared = liveEndpoints().filter(
      (endpoint) => !(endpoint in ACCESS_CONTRACT)
    );
    expect(undeclared).toEqual([]);
  });

  it("declares no endpoint that has been removed or renamed", () => {
    // Also the guard against a regex that stops matching: if SERVER_FN breaks,
    // `liveEndpoints()` returns nothing and every declaration reports here as
    // stale, which is loud and names the problem. No separate count assertion
    // is needed, and a vague one ("more than 80 found") would pass while six
    // endpoints went missing.
    const live = new Set(liveEndpoints());
    const stale = Object.keys(ACCESS_CONTRACT).filter(
      (endpoint) => !live.has(endpoint)
    );
    expect(stale).toEqual([]);
  });

  it("keeps the public surface to exactly these endpoints", () => {
    // The one assertion that reads a declared level, and the reason the levels
    // are not inert data. `public` is the only level where a careless
    // declaration is itself the bug: every other value fails closed if it is
    // too generous by one step, but a wrong `public` ships the data.
    //
    // Adding one means editing this list too, which is a line a reviewer sees.
    // If you are here because the test failed, the question to answer is
    // whether the new endpoint should be reachable with no session at all.
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
