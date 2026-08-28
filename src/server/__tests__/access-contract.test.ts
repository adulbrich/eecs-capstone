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
 * What it enforces is that the two lists name the same endpoints, that no use
 * of `createServerFn` escapes the parser, and that the public surface is
 * exactly the one written down.
 */

const SRC_DIR = join(process.cwd(), "src");

/**
 * `export const <name> = createServerFn`, allowing a type annotation and a line
 * break before the initializer. Both are legal and both were invisible to the
 * first version of this pattern, which is why nothing here trusts it alone.
 */
const ENDPOINT_DECLARATION =
  /^export const (\w+)\s*(?::[^=\n]+)?=\s*createServerFn/gm;

const FACTORY = /\bcreateServerFn\b/g;

/** Test files declare no endpoints, and `node_modules` is not ours. */
const SKIP_DIRS = new Set(["__tests__", "node_modules"]);
const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

function typeScriptFilesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) {
        found.push(...typeScriptFilesUnder(full));
      }
    } else if (SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      found.push(full);
    }
  }
  return found;
}

/**
 * Blank out comments and string literals, preserving every offset and newline
 * so positions and line numbers still line up with the original.
 *
 * Line-anchored filters were tried first and were wrong three ways: a trailing
 * comment, a string mentioning the factory, and a wrapped multi-line import all
 * slipped through and turned the check red on correct code.
 */
function maskCommentsAndStrings(source: string): string {
  const out = source.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let k = from; k < to && k < out.length; k++) {
      if (out[k] !== "\n") {
        out[k] = " ";
      }
    }
  };
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      let k = i + 1;
      while (k < source.length && source[k] !== quote) {
        k += source[k] === "\\" ? 2 : 1;
      }
      blank(i, k + 1);
      i = k + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/**
 * Blank import statements too. Run after masking, so the module specifier is
 * already gone and a statement is simply `import` up to its semicolon, which is
 * what makes a wrapped multi-line import safe to match.
 */
function maskImports(masked: string): string {
  return masked.replace(/\bimport\b[^;]*;/g, (match) =>
    match.replace(/[^\n]/g, " ")
  );
}

function lineOf(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

function scan() {
  const declared: string[] = [];
  const unparsed: string[] = [];

  for (const file of typeScriptFilesUnder(SRC_DIR)) {
    const source = readFileSync(file, "utf8");
    const code = maskImports(maskCommentsAndStrings(source));
    const label = relative(SRC_DIR, file);

    const covered: [number, number][] = [];
    for (const match of source.matchAll(ENDPOINT_DECLARATION)) {
      declared.push(`${label}:${match[1]}`);
      const start = match.index ?? 0;
      covered.push([start, start + match[0].length]);
    }

    for (const mention of code.matchAll(FACTORY)) {
      const at = mention.index ?? 0;
      const parsed = covered.some(([from, to]) => at >= from && at < to);
      if (!parsed) {
        unparsed.push(`${label}:${lineOf(source, at)}`);
      }
    }
  }

  return { declared: declared.sort(), unparsed: unparsed.sort() };
}

function liveEndpoints(): string[] {
  return scan().declared;
}

function declaredAt(level: string): string[] {
  return Object.entries(ACCESS_CONTRACT)
    .filter(([, declaration]) => declaration.level === level)
    .map(([endpoint]) => endpoint)
    .sort();
}

describe("the server function access contract", () => {
  it("parses every use of createServerFn", () => {
    // The guard that makes the other assertions trustworthy. They compare the
    // parsed list against ACCESS_CONTRACT, so an endpoint the pattern cannot
    // read is absent from both sides and reports nothing at all rather than
    // reporting as undeclared. Two real shapes escaped that way: a type
    // annotation, and a line break before the initializer.
    //
    // If this fails it names the file and line. Widen ENDPOINT_DECLARATION to
    // cover that shape; do not add it to an ignore list.
    expect(scan().unparsed).toEqual([]);
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
