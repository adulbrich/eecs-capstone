import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { ACCESS_CONTRACT } from "./access-contract";

/**
 * Holds `access-contract.ts` to the code. It infers no endpoint's access level:
 * inferring is what #108 rules out, because a grep for the guard names
 * mislabelled seven of seventeen endpoints and could not tell a correctly
 * ungated public read from a gate it failed to recognize.
 *
 * What it enforces is that the two lists name the same endpoints, that no use
 * of `createServerFn` escapes the scan, and that the public surface is exactly
 * the one written down.
 *
 * It reads the real TypeScript AST rather than matching text. Two hand-written
 * attempts came first and both were wrong: a line-anchored filter tripped over
 * a wrapped import, a trailing comment and a string literal, and the character
 * masker that replaced it treated `/["']/` as an unterminated string and
 * blanked the rest of the file, which silently disarmed the check for
 * everything below that line. Comments, strings, JSX text and regex literals
 * contain no identifiers, so the parser gets all four right for free.
 */

const SRC_DIR = join(process.cwd(), "src");

const FACTORY = "createServerFn";

/**
 * `node_modules` is not ours, and `__tests__` holds no endpoints. `src/test/` is
 * deliberately still scanned: it is test infrastructure rather than test cases,
 * and an endpoint declared there would be as reachable as any other.
 */
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
 * Walk down `createServerFn({...}).inputValidator(...).handler(...)` to the
 * identifier the chain is rooted in, and return it only if the chain actually
 * calls it. `createServerFn.mock()` and a bare `export const x = createServerFn`
 * both reach the identifier without calling it, and neither is an endpoint.
 */
function calledFactory(node: ts.Node): ts.Identifier | undefined {
  let current: ts.Node = node;
  while (true) {
    if (ts.isCallExpression(current)) {
      if (
        ts.isIdentifier(current.expression) &&
        current.expression.text === FACTORY
      ) {
        return current.expression;
      }
      current = current.expression;
    } else if (ts.isPropertyAccessExpression(current)) {
      current = current.expression;
    } else {
      return;
    }
  }
}

function isExported(statement: ts.VariableStatement): boolean {
  return (
    statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    ) ?? false
  );
}

function withinImport(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isImportDeclaration(n) || ts.isImportEqualsDeclaration(n)) {
      return true;
    }
  }
  return false;
}

function scanFile(file: string, source: string) {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );

  // A file the parser could not read yields an empty tree, which every
  // assertion below would read as "nothing here" rather than as a problem.
  // `npm run typecheck` catches this first in CI, but a check that can quietly
  // examine nothing is the defect this whole file exists to remove.
  const parseErrors = (
    sourceFile as unknown as { parseDiagnostics?: unknown[] }
  ).parseDiagnostics;
  if (parseErrors && parseErrors.length > 0) {
    throw new Error(
      `${file} did not parse, so its endpoints cannot be read. Fix the syntax error; typecheck will name it.`
    );
  }

  const declared: string[] = [];
  // The exact identifier nodes an endpoint declaration is built on, not their
  // positions. A span would clear every other use inside the same statement,
  // and `export const a = createServerFn()..., b = wrap(createServerFn()...)`
  // then loses `b` from both the declared list and the unrecognized one.
  const accounted = new Set<ts.Node>();

  for (const statement of sourceFile.statements) {
    if (!(ts.isVariableStatement(statement) && isExported(statement))) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const factory = declaration.initializer
        ? calledFactory(declaration.initializer)
        : undefined;
      if (factory && ts.isIdentifier(declaration.name)) {
        declared.push(declaration.name.text);
        accounted.add(factory);
      }
    }
  }

  const unparsed: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === FACTORY &&
      !(withinImport(node) || accounted.has(node))
    ) {
      unparsed.push(
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { declared, unparsed };
}

let cached: { declared: string[]; unparsed: string[] } | undefined;

/** Parsing every file costs about 250ms, and four assertions want the answer. */
function scan() {
  if (cached) {
    return cached;
  }
  const declared: string[] = [];
  const unparsed: string[] = [];
  for (const file of typeScriptFilesUnder(SRC_DIR)) {
    const label = relative(SRC_DIR, file);
    const result = scanFile(file, readFileSync(file, "utf8"));
    declared.push(...result.declared.map((name) => `${label}:${name}`));
    unparsed.push(...result.unparsed.map((line) => `${label}:${line}`));
  }
  cached = { declared: declared.sort(), unparsed: unparsed.sort() };
  return cached;
}

function declaredAt(level: string): string[] {
  return Object.entries(ACCESS_CONTRACT)
    .filter(([, declaration]) => declaration.level === level)
    .map(([endpoint]) => endpoint)
    .sort();
}

describe("the server function access contract", () => {
  it("recognizes every use of createServerFn", () => {
    // The guard that makes the other assertions trustworthy. They compare the
    // recognized list against ACCESS_CONTRACT, so a use the scan cannot read is
    // absent from both sides and reports nothing at all rather than reporting
    // as undeclared.
    //
    // If this fails it names the file and line. Teach the scan that shape; do
    // not add it to an ignore list.
    expect(scan().unparsed).toEqual([]);
  });

  it("declares a level for every endpoint that exists", () => {
    const undeclared = scan().declared.filter(
      (endpoint) => !(endpoint in ACCESS_CONTRACT)
    );
    expect(undeclared).toEqual([]);
  });

  it("declares no endpoint that has been removed or renamed", () => {
    const live = new Set(scan().declared);
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
