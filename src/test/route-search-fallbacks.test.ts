import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every field of every route's `validateSearch` schema falls back on a bad
 * value, so a hand-edited or stale URL renders the page as if that param were
 * absent instead of failing into the framework's error page (#609).
 *
 * A field passes when its zod chain calls `.catch` anywhere, or when it is
 * `searchParamQuerySchema`, which catches inside. The router JSON-parses each
 * value before the schema sees it, so no field is safe without one: even a
 * bare `z.string()` throws on `?cols=123`.
 *
 * Reads the AST, for the reason `search-query-schemas.test.ts` gives: a regex
 * cannot tell a field from a comment describing one.
 */

const ROUTES_DIR = join(process.cwd(), "src/routes");

const SAFE_ROOTS = new Set(["searchParamQuerySchema"]);

function routeFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return routeFiles(path);
    }
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

/** True when the chain calls `.catch`, or starts at a schema that does. */
function fallsBack(node: ts.Expression): boolean {
  let current: ts.Expression = node;
  while (
    ts.isCallExpression(current) ||
    ts.isPropertyAccessExpression(current)
  ) {
    if (
      ts.isPropertyAccessExpression(current) &&
      current.name.text === "catch"
    ) {
      return true;
    }
    current = current.expression;
  }
  return ts.isIdentifier(current) && SAFE_ROOTS.has(current.text);
}

/** The object literal a `z.object({...})` call is built from, if it is one. */
function objectLiteral(node: ts.Expression): ts.ObjectLiteralExpression | null {
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === "object" &&
    node.arguments[0] !== undefined &&
    ts.isObjectLiteralExpression(node.arguments[0])
  ) {
    return node.arguments[0];
  }
  return null;
}

interface Scan {
  schemas: number;
  unguarded: string[];
}

function scan(file: string): Scan {
  const source = readFileSync(file, "utf8");
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const declarations = new Map<string, ts.Expression>();
  const validators: ts.Expression[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      declarations.set(node.name.text, node.initializer);
    }
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "validateSearch"
    ) {
      validators.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);

  const result: Scan = { schemas: 0, unguarded: [] };
  for (const validator of validators) {
    const schema = ts.isIdentifier(validator)
      ? declarations.get(validator.text)
      : validator;
    const fields = schema && objectLiteral(schema);
    if (!fields) {
      result.unguarded.push(
        `${relative(process.cwd(), file)}: validateSearch is not a z.object this scan can read`
      );
      continue;
    }
    result.schemas++;
    for (const property of fields.properties) {
      if (
        !(ts.isPropertyAssignment(property) && ts.isIdentifier(property.name))
      ) {
        continue;
      }
      if (!fallsBack(property.initializer)) {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          property.getStart(sourceFile)
        );
        result.unguarded.push(
          `${relative(process.cwd(), file)}:${line + 1} ${property.name.text}`
        );
      }
    }
  }
  return result;
}

const scans = routeFiles(ROUTES_DIR).map(scan);

describe("route search schemas", () => {
  it("finds the schemas at all", () => {
    // The scan reports nothing when it stops seeing the shape it reads. There
    // were nineteen when #609 landed.
    const schemas = scans.reduce((total, one) => total + one.schemas, 0);
    expect(schemas).toBeGreaterThanOrEqual(19);
  });

  it("gives every field a fallback for a malformed value", () => {
    expect(scans.flatMap((one) => one.unguarded)).toEqual([]);
  });
});
