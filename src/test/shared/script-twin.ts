import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/**
 * Runs a script's own copy of some top-level declarations, without running
 * the script.
 *
 * The ops scripts under `scripts/` cannot import `src/` (ADR-0024), so they
 * carry copies, and the parity tests compare each copy with its twin as text.
 * Text cannot show that two bodies behave alike wherever the comparison
 * normalises them: collapsing whitespace hides a changed space inside a
 * template literal. This parses the file, lifts the named declarations out
 * of it, and runs only those in a fresh `node:vm` context, so the script's
 * imports, its database pool and its `await main()` never run.
 *
 * Name every declaration the lifted code reads, the script's constants
 * included: lifting `SOURCE_LIMIT` from the script rather than importing it
 * from `src/` is what makes the run a run of the script's copy. Anything the
 * script imports, `createHash` say, goes in `globals`. A name left out fails
 * as "X is not defined" the first time the code reaches it.
 *
 * A `.ts` file is transpiled first, which only strips its annotations. The
 * code runs strict, as the scripts do: they are ES modules.
 */
export function runScriptDeclarations<T>(
  path: string,
  names: readonly string[],
  globals: Record<string, unknown>
): T {
  const file = ts.createSourceFile(
    path,
    readFileSync(path, "utf8"),
    ts.ScriptTarget.Latest,
    true
  );
  const lifted = file.statements.filter((statement) =>
    declaredNames(statement).some((name) => names.includes(name))
  );
  const found = lifted.flatMap(declaredNames);
  const missing = names.filter((name) => !found.includes(name));
  if (missing.length > 0) {
    throw new Error(
      `No top-level declaration of ${missing.join(", ")} in ${path}`
    );
  }
  const code = lifted.map((statement) => statement.getText(file)).join("\n");
  const runnable = path.endsWith(".ts")
    ? ts.transpileModule(code, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText
    : code;
  return runInNewContext(
    `"use strict";\n${runnable}\n({ ${names.join(", ")} });`,
    { ...globals }
  ) as T;
}

/** The names a top-level function or `const` declares, and none otherwise. */
function declaredNames(statement: ts.Statement): string[] {
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    return [statement.name.text];
  }
  if (ts.isVariableStatement(statement)) {
    return statement.declarationList.declarations.flatMap((declaration) =>
      ts.isIdentifier(declaration.name) ? [declaration.name.text] : []
    );
  }
  return [];
}
