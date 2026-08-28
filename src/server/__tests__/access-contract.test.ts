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
 * Walk down `createServerFn({...}).inputValidator(...).handler(...)` to the
 * identifier the chain is rooted in.
 */
function chainRoot(node: ts.Node): ts.Node {
  let current = node;
  while (
    ts.isCallExpression(current) ||
    ts.isPropertyAccessExpression(current)
  ) {
    current = current.expression;
  }
  return current;
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

  const declared: string[] = [];
  const accepted: [number, number][] = [];

  for (const statement of sourceFile.statements) {
    if (!(ts.isVariableStatement(statement) && isExported(statement))) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const root = declaration.initializer
        ? chainRoot(declaration.initializer)
        : undefined;
      if (
        root &&
        ts.isIdentifier(root) &&
        root.text === FACTORY &&
        ts.isIdentifier(declaration.name)
      ) {
        declared.push(declaration.name.text);
        accepted.push([statement.getStart(sourceFile), statement.end]);
      }
    }
  }

  const unparsed: number[] = [];
  const visit = (node: ts.Node) => {
    if (
      ts.isIdentifier(node) &&
      node.text === FACTORY &&
      !withinImport(node) &&
      !accepted.some(
        ([from, to]) => node.getStart(sourceFile) >= from && node.end <= to
      )
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

/** Parsing every file is ~40ms, and three assertions want the same answer. */
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
