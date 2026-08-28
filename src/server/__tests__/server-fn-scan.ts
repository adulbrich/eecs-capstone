import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * Finds every `createServerFn` endpoint in `src/`, and every use of it the
 * search could not turn into one. `access-contract.test.ts` compares the first
 * list against the declared contract and fails on the second.
 *
 * It deduces nothing about access levels. Inferring is what #108 rules out: a
 * grep for the guard names mislabelled seven of seventeen endpoints, and could
 * not tell a correctly ungated public read from a gate it failed to recognize.
 * This finds endpoints; a human declares what each one is allowed to do.
 *
 * It reads the real TypeScript AST rather than matching text. Two hand-written
 * attempts came first and both were wrong: a line-anchored filter tripped over
 * a wrapped import, a trailing comment and a string literal, and the character
 * masker that replaced it treated `/["']/` as an unterminated string and
 * blanked the rest of the file, which silently disarmed the check for
 * everything below that line. Comments, strings, JSX text and regex literals
 * contain no identifiers, so the parser gets all four right for free.
 *
 * Lives outside the test file so `scanFile` can be exported and driven with
 * sources written to break it. A scan checked only against the tree it already
 * agrees with cannot show it would notice anything new.
 */

const SRC_DIR = join(process.cwd(), "src");

const FACTORY = "createServerFn";

/**
 * `node_modules` is not ours. `__tests__` is skipped because nothing imports it
 * into the app's module graph, so an endpoint written there is never built into
 * the server bundle and is not reachable over HTTP. That is the reason, rather
 * than an assumption that no such file would ever contain one.
 *
 * `src/test/` is deliberately still scanned: it is test infrastructure that the
 * app can import, so an endpoint declared there would be as reachable as any
 * other.
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
 * The names this file binds `createServerFn` to, taken from its imports of
 * `@tanstack/react-start`. An import may rename it, and an alias was the one
 * shape that escaped both halves of this check: the scan compared identifier
 * text against `createServerFn`, so `make()` declared no endpoint, and the
 * unrecognized-use guard suppresses everything inside an import declaration, so
 * the sole occurrence of the real name raised nothing either. An endpoint could
 * ship undeclared with all four assertions green.
 *
 * The module is part of the test, not decoration. Without it
 * `import { chunk as createServerFn } from "lodash"` binds the name this scan
 * keys on to a foreign function, and every call of it would be declared an
 * endpoint that does not exist. It is also the import `AGENTS.md` requires, so
 * a file reaching for the deprecated `@tanstack/start` fails here rather than
 * scanning clean.
 */
const FACTORY_MODULE = "@tanstack/react-start";

function factoryImports(sourceFile: ts.SourceFile) {
  const names = new Set<string>();
  // Imports of the factory from anywhere else, by the line they sit on.
  // `import { createServerFn as make } from "@tanstack/react-start/server"`
  // spells the real name only inside the import, where the guard below
  // suppresses it, and binds `make`, which is not a name from the module this
  // keys on. It reached neither list. Reporting the import itself is what makes
  // a near-miss specifier loud instead of silent.
  const foreign: ts.ImportSpecifier[] = [];
  for (const statement of sourceFile.statements) {
    if (
      !(
        ts.isImportDeclaration(statement) &&
        ts.isStringLiteral(statement.moduleSpecifier)
      )
    ) {
      continue;
    }
    const bindings = statement.importClause?.namedBindings;
    if (!(bindings && ts.isNamedImports(bindings))) {
      continue;
    }
    const fromFactoryModule = statement.moduleSpecifier.text === FACTORY_MODULE;
    for (const element of bindings.elements) {
      // `propertyName` is set only on `{ a as b }`, where it holds `a`.
      if ((element.propertyName ?? element.name).text !== FACTORY) {
        continue;
      }
      if (fromFactoryModule) {
        names.add(element.name.text);
      } else {
        foreign.push(element);
      }
    }
  }
  return { foreign, names };
}

/**
 * Walk down `createServerFn({...}).inputValidator(...).handler(...)` to the
 * identifier the chain is rooted in, and return it only if the chain actually
 * calls it. `createServerFn.mock()` and a bare `export const x = createServerFn`
 * both reach the identifier without calling it, and neither is an endpoint.
 */
function calledFactory(
  node: ts.Node,
  names: ReadonlySet<string>
): ts.Identifier | undefined {
  let current: ts.Node = node;
  while (true) {
    if (ts.isCallExpression(current)) {
      if (
        ts.isIdentifier(current.expression) &&
        names.has(current.expression.text)
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

/**
 * Only an `import ... from` declaration, deliberately. `import make =
 * ns.createServerFn` also parses as an import, and suppressing it put that
 * binding in neither list: not declared, not reported. It is contrived, but the
 * guard's whole claim is that nothing goes quiet.
 */
function withinImport(node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    if (ts.isImportDeclaration(n)) {
      return true;
    }
  }
  return false;
}

/**
 * Exported so the scan can be run against sources written to break it. Reading
 * the real `src/` tree proves the scan and the contract agree today; it cannot
 * show the scan would notice a shape nobody has written yet, which is the only
 * thing this file exists to guarantee.
 */
export function scanFile(file: string, source: string) {
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
  // `parseDiagnostics` is internal, so a TypeScript release that renames it
  // would leave this reading `undefined`. Treat absent and non-empty alike:
  // otherwise the rename disarms the guard silently, which is the exact defect
  // this block exists to prevent.
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
      `${file} did not parse, so its endpoints cannot be read. Fix the syntax error; typecheck will name it.`
    );
  }

  const { foreign, names } = factoryImports(sourceFile);
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
        ? calledFactory(declaration.initializer, names)
        : undefined;
      if (factory && ts.isIdentifier(declaration.name)) {
        declared.push(declaration.name.text);
        accounted.add(factory);
      }
    }
  }

  const unparsed: number[] = foreign.map(
    (element) =>
      sourceFile.getLineAndCharacterOfPosition(element.getStart(sourceFile))
        .line + 1
  );
  const visit = (node: ts.Node) => {
    // Two ways to be unrecognized. A bound name that no exported declaration
    // turned into an endpoint is a use this scan could not read. The literal
    // `createServerFn` reached any other way (a namespace import calling
    // `ns.createServerFn()`, an import from some other module, a local of that
    // name) is not a binding at all, and is reported rather than declared: a
    // wrong endpoint in the contract is worse than a loud one out of it.
    const suspicious = ts.isIdentifier(node)
      ? (names.has(node.text) || node.text === FACTORY) &&
        !(withinImport(node) || accounted.has(node))
      : // `ns["createServerFn"]` puts the name in a string, where an identifier
        // visitor never sees it. Only as an element access: a plain string
        // holding this name is prose, and this file's own tests are full of it.
        ts.isStringLiteral(node) &&
        node.text === FACTORY &&
        ts.isElementAccessExpression(node.parent);
    if (suspicious) {
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
export function scan() {
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
