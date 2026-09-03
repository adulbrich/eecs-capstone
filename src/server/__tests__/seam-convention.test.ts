import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * Enforces the `*As` first, `*ForCurrentUser` second convention documented in
 * `docs/QUIRKS.md`.
 *
 * This replaces a grep that could not fail. It printed every wrapper name
 * unconditionally and paired none of them, so a clean tree and a broken one
 * produced the same 59 lines. Six wrappers once shipped with no seam under
 * them, and the cost was exactly what the convention predicts: two bookmark
 * cases inserted rows directly because they could not reach the code, one
 * re-implemented the join it asserted on, the `canSeeProject` check on that
 * path had no coverage at all, and the two avatar tests sat in `describe.skip`.
 *
 * Reads source off disk rather than importing the modules, so it cannot be
 * broken by an import cycle and does not need a database. It reads the
 * TypeScript AST rather than matching text, because a regex cannot tell code
 * from a comment: a wrapper whose only seam was commented out satisfied the
 * first version of this test, which is the exact shape the convention exists
 * to catch. Comments and strings contain no identifiers, so the parser gets
 * both right by construction. `access-contract.test.ts`
 * next door walks the same tree for the same reason; the walk is duplicated
 * rather than shared because the two tests skip different things, and a shared
 * scanner would be a third file to keep honest.
 */

const INTERNAL_DIR = join(process.cwd(), "src/server/_internal");

const WRAPPER_SUFFIX = "ForCurrentUser";

function isExported(statement: ts.Statement): boolean {
  if (!ts.canHaveModifiers(statement)) {
    return false;
  }
  const modifiers = ts.getModifiers(statement) ?? [];
  return modifiers.some(
    (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
  );
}

/**
 * Every exported top-level binding, function declarations and variable
 * statements alike. A wrapper written as
 * `export const xForCurrentUser = async () => ...` has to be seen too: a scan
 * that stops seeing a shape is how the grep this replaces managed to pass on a
 * tree it had never checked.
 */
function exportedNames(file: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ false,
    ts.ScriptKind.TS
  );

  // A file the parser could not read yields an empty tree, which the pairing
  // below would read as "no wrappers here" rather than as a problem. The
  // same guard, with the same reasoning, sits in `server-fn-scan.ts`.
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
      `${file} did not parse, so its exports cannot be read. Fix the syntax error; typecheck will name it.`
    );
  }

  const names: string[] = [];
  for (const statement of sourceFile.statements) {
    if (!isExported(statement)) {
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name) {
      names.push(statement.name.text);
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          names.push(declaration.name.text);
        }
      }
    }
  }
  return names;
}

function internalFiles(): string[] {
  return readdirSync(INTERNAL_DIR).filter((name) => name.endsWith(".ts"));
}

function pairWrappersToSeams() {
  const wrappers: string[] = [];
  const unpaired: string[] = [];

  for (const file of internalFiles()) {
    const names = exportedNames(
      file,
      readFileSync(join(INTERNAL_DIR, file), "utf8")
    );
    const seams = new Set(names.filter((name) => /(?:As|Impl)$/.test(name)));

    for (const wrapper of names.filter((name) =>
      name.endsWith(WRAPPER_SUFFIX)
    )) {
      wrappers.push(`${file}: ${wrapper}`);
      const stem = wrapper.slice(0, -WRAPPER_SUFFIX.length);
      if (!(seams.has(`${stem}As`) || seams.has(`${stem}Impl`))) {
        unpaired.push(`${file}: ${wrapper}`);
      }
    }
  }

  return { wrappers, unpaired };
}

describe("the *As / *Impl seam convention", () => {
  it("reads bindings, not text, so a commented-out seam is no seam", () => {
    // The defect this file was rewritten for: a regex over raw source counted
    // the seam inside the comment below as real, and the wrapper shipped with
    // nothing under it. The string case is the other direction, a name that
    // is prose being counted as a wrapper. Both are fed through the same
    // function the real scan uses, so this cannot drift from it.
    const source = [
      "// export async function widgetAs(viewer: unknown) {}",
      'const label = "gadgetForCurrentUser";',
      "export async function widgetForCurrentUser() {",
      "  return label;",
      "}",
      "export const probeAs = async () => {};",
    ].join("\n");
    expect(exportedNames("probe.ts", source)).toEqual([
      "widgetForCurrentUser",
      "probeAs",
    ]);
  });

  it("finds wrappers to check, so a walk that stops seeing them fails loudly", () => {
    // Without this, deleting the convention or breaking the walk above leaves
    // a test that passes because it examined nothing. That is the failure
    // mode this file exists to remove, so it is asserted first.
    expect(pairWrappersToSeams().wrappers.length).toBeGreaterThan(50);
  });

  it("gives every wrapper a same-stem seam in the same file", () => {
    // Names the wrappers rather than reporting a count: the message is the
    // whole point, since the fix is to add a seam to the ones listed.
    expect(pairWrappersToSeams().unpaired).toEqual([]);
  });
});
