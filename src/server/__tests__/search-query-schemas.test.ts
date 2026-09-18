import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Every search field under `src/server/` is `searchQuerySchema`, never a zod
 * chain of its own.
 *
 * The eight of them disagreed before #478: four capped at 200 and threw out
 * of `.parse` past it, which took the public listing to the framework's
 * default error page, and four had no cap at all. A list in a doc could not
 * fail, and a review could not see the other seven while reading one, so the
 * agreement is pinned here.
 *
 * Reads the AST rather than grepping, for the reason `seam-convention.test.ts`
 * next door gives: a regex cannot tell code from a comment, and the point is
 * to catch a field that goes back to `z.string()`, which is exactly what a
 * commented-out example looks like.
 */

const SERVER_DIR = join(process.cwd(), "src/server");

const QUERY_FIELDS = new Set(["q", "query"]);

/** The identifier a chain like `z.string().trim()` or `x.optional()` starts at. */
function chainRoot(node: ts.Expression): string | null {
  let current: ts.Expression = node;
  while (
    ts.isCallExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isPropertyAccessExpression(current)
  ) {
    current = current.expression;
  }
  return ts.isIdentifier(current) ? current.text : null;
}

function parse(file: string, source: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS
  );
  const parseErrors = (
    sourceFile as unknown as { parseDiagnostics?: unknown[] }
  ).parseDiagnostics;
  if (!Array.isArray(parseErrors)) {
    throw new Error(
      "TypeScript no longer exposes parseDiagnostics, so a file that fails to parse would be read as empty. Replace this check with ts.transpileModule(source, { reportDiagnostics: true })."
    );
  }
  if (parseErrors.length > 0) {
    throw new Error(
      `${file} did not parse, so its schemas cannot be read. Fix the syntax error; typecheck will name it.`
    );
  }
  return sourceFile;
}

/**
 * Every `q`/`query` property in the file whose value is a zod chain, as
 * `file:line root`. A property whose value is not built from an identifier
 * chain (a nested object, a literal) is not a schema field and is skipped;
 * `query:` on a non-zod object, of which there are several, roots at
 * something other than `z` or `searchQuerySchema` and is reported as neither.
 */
function queryFields(file: string): { location: string; root: string }[] {
  const source = readFileSync(join(SERVER_DIR, file), "utf8");
  const sourceFile = parse(file, source);
  const found: { location: string; root: string }[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      QUERY_FIELDS.has(node.name.text)
    ) {
      const root = chainRoot(node.initializer);
      if (root === "z" || root === "searchQuerySchema") {
        const { line } = sourceFile.getLineAndCharacterOfPosition(
          node.getStart(sourceFile)
        );
        found.push({ location: `${file}:${line + 1}`, root });
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

function allQueryFields() {
  return readdirSync(SERVER_DIR)
    .filter((name) => name.endsWith(".ts"))
    .flatMap((file) => queryFields(file));
}

describe("search query schemas", () => {
  it("finds the search fields at all", () => {
    // The scan reports nothing when it stops seeing the shape it reads, and
    // nothing passes the assertion below. Eight is the count #478 unified:
    // searchProjects, listAdminProjects, listUsers, searchUsers, listMentors
    // and the three inventory listings.
    expect(allQueryFields().length).toBeGreaterThanOrEqual(8);
  });

  it("builds every one of them from searchQuerySchema", () => {
    const rogue = allQueryFields()
      .filter((field) => field.root === "z")
      .map((field) => field.location);
    expect(rogue).toEqual([]);
  });
});
