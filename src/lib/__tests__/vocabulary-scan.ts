import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";

/**
 * Finds every hand-written copy of a status vocabulary.
 *
 * #102 made each vocabulary a single `as const` tuple in
 * `src/lib/vocabularies.ts` and swept twenty-one consumers onto it by hand.
 * The tuple half is enforced, because `pgEnum` and the derived unions read the
 * same tuple. The sweep half was not, and #271 is that gap: a status added to
 * a tuple and not to a copy is a filter that cannot select it, a badge with no
 * label, or a chart bar that is not drawn.
 *
 * ## What counts as a copy
 *
 * One array literal or one written-out union naming **every** member of a
 * vocabulary. Nothing less. That threshold is the whole design, and the
 * alternatives were rejected for reasons worth not relitigating:
 *
 * - A copy is written complete, so this fails the pull request that writes the
 *   twenty-second one. A copy that goes stale later can then only descend from
 *   a subset somebody wrote deliberately and a reviewer read.
 * - "One short of complete" buys only `ACTIVE_STATUSES`, which #271 derived
 *   from the tuple instead, and costs a false positive budget forever after.
 * - "Two or more unless declared" taxes four legitimate `inArray` filters and
 *   `sendToProposer`'s `target` to catch a case the types already catch
 *   wherever a `Record` is keyed by the union.
 *
 * A `Record` keyed by a vocabulary is deliberately **not** a copy and is not
 * examined. The label and style tables in `status-badge.tsx`,
 * `inventory-status-badge.tsx`, `inventory-filter-bar.tsx`,
 * `admin/analytics.tsx` and `my/items.tsx` all name a whole vocabulary on
 * purpose, and the type already forces them to be total: adding a status
 * fails to compile there rather than silently rendering nothing. Those are the
 * shape that works. Only the two shapes #102 could not catch are in scope.
 *
 * ## The vocabularies are discovered, not listed
 *
 * This reads `vocabularies.ts` and takes every exported `as const` array of
 * string literals. Listing them here would be a fourth copy of exactly the
 * thing this file exists to forbid, and a new vocabulary would arrive
 * unscanned.
 */

const SRC_DIR = join(process.cwd(), "src");
const VOCABULARIES_FILE = join(SRC_DIR, "lib", "vocabularies.ts");

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts"];

/**
 * Tests are not scanned, and not for `server-fn-scan`'s reason.
 *
 * That scan skips `__tests__` because an endpoint declared there is never
 * built into the server bundle and cannot be reached over HTTP. That argument
 * does not transfer: a stale copy in a test is a test that quietly stops
 * covering a new status, which is a real loss.
 *
 * The reason here is that this scan cannot tell a test's case list from its
 * expected value. Deriving the case list from a tuple is good, and
 * `workflow-totality.test.ts` already does it, so a seventh status is covered
 * for free. Deriving the expected value is a tautology. Both are an array of
 * six string literals and no AST separates them. `statusRank`'s test in
 * `inventory-visibility.test.ts` is the worked example: its second array is an
 * independent statement of the intended lifecycle order, and importing the
 * tuple there would assert `indexOf` ordering against the tuple it indexes,
 * which is precisely the reordering the test exists to catch.
 *
 * So a complete vocabulary is a copy in production code and is often the
 * expectation in a test, and the boundary belongs in the rule rather than in a
 * suppression comment somebody has to remember to justify.
 */
const SKIP_DIRS = new Set(["__tests__", "node_modules", "test"]);

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

function parse(file: string, source: string): ts.SourceFile {
  const sourceFile = ts.createSourceFile(
    file,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  );
  // A file the parser could not read yields an empty tree, which this scan
  // would read as "no copies here" rather than as a problem. Same reasoning
  // and same failure mode as `server-fn-scan.ts`, which records why the
  // internal `parseDiagnostics` is read rather than trusted to exist.
  const parseErrors = (
    sourceFile as unknown as { parseDiagnostics?: unknown[] }
  ).parseDiagnostics;
  if (!Array.isArray(parseErrors)) {
    throw new Error(
      "TypeScript no longer exposes parseDiagnostics, so a file that fails to parse would be read as having no vocabulary copies. Replace this check with ts.transpileModule(source, { reportDiagnostics: true })."
    );
  }
  if (parseErrors.length > 0) {
    throw new Error(
      `${file} did not parse, so it cannot be scanned for vocabulary copies. Fix the syntax error; typecheck will name it.`
    );
  }
  return sourceFile;
}

/** One vocabulary: the exported name, and the members it holds. */
export interface Vocabulary {
  members: ReadonlySet<string>;
  name: string;
}

/**
 * Every exported `as const` array of string literals in a source. Run against
 * `vocabularies.ts` this yields the vocabularies; exported so a test can run
 * it against a source of its own.
 */
export function vocabulariesIn(file: string, source: string): Vocabulary[] {
  const found: Vocabulary[] = [];
  for (const statement of parse(file, source).statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    const exported = statement.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword
    );
    if (!exported) {
      continue;
    }
    for (const declaration of statement.declarationList.declarations) {
      const initializer = declaration.initializer;
      if (
        !(
          initializer &&
          ts.isAsExpression(initializer) &&
          ts.isArrayLiteralExpression(initializer.expression) &&
          ts.isIdentifier(declaration.name)
        )
      ) {
        continue;
      }
      // `.every` with a type predicate does not narrow the array, so the
      // literals are collected first and the count compared afterwards. An
      // array holding anything but string literals is not a vocabulary.
      const elements = initializer.expression.elements;
      const literals = elements.filter(ts.isStringLiteral);
      if (literals.length === 0 || literals.length !== elements.length) {
        continue;
      }
      found.push({
        name: declaration.name.text,
        members: new Set(literals.map((literal) => literal.text)),
      });
    }
  }
  return found;
}

/** One place a whole vocabulary is written out. */
export interface Copy {
  /** 1-indexed. */
  line: number;
  /** The vocabulary's exported name in `vocabularies.ts`. */
  vocabulary: string;
}

function namesWholeVocabulary(
  members: string[],
  vocabularies: readonly Vocabulary[]
): string | undefined {
  if (members.length === 0) {
    return;
  }
  const present = new Set(members);
  return vocabularies.find(
    (vocabulary) =>
      vocabulary.members.size <= present.size &&
      [...vocabulary.members].every((member) => present.has(member))
  )?.name;
}

/**
 * Exported so the scan can be run against sources written to break it.
 * Reading the real `src/` tree proves the scan agrees with the tree today; it
 * cannot show the scan would notice a shape nobody has written yet, which is
 * the only thing this file exists to guarantee.
 */
export function scanFile(
  file: string,
  source: string,
  vocabularies: readonly Vocabulary[]
): Copy[] {
  const sourceFile = parse(file, source);
  const copies: Copy[] = [];

  const record = (node: ts.Node, members: string[]) => {
    const vocabulary = namesWholeVocabulary(members, vocabularies);
    if (vocabulary) {
      copies.push({
        vocabulary,
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
      });
    }
  };

  const visit = (node: ts.Node) => {
    if (ts.isArrayLiteralExpression(node)) {
      // Only the literal elements. A spread of the tuple is the derivation
      // this scan is asking for, and an array mixing one in with literals is
      // still judged on the literals it wrote out itself.
      record(
        node,
        node.elements.filter(ts.isStringLiteral).map((element) => element.text)
      );
    } else if (ts.isUnionTypeNode(node)) {
      record(
        node,
        node.types.flatMap((type) =>
          ts.isLiteralTypeNode(type) && ts.isStringLiteral(type.literal)
            ? [type.literal.text]
            : []
        )
      );
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return copies;
}

/** Every copy in `src/`, as `path:line names VOCABULARY` lines. */
export function scan(): string[] {
  const vocabularies = vocabulariesIn(
    VOCABULARIES_FILE,
    readFileSync(VOCABULARIES_FILE, "utf8")
  );
  if (vocabularies.length === 0) {
    throw new Error(
      `No vocabularies found in ${VOCABULARIES_FILE}. Either they moved, or they stopped being exported "as const" arrays of string literals, and this scan is now checking nothing.`
    );
  }
  const found: string[] = [];
  for (const file of typeScriptFilesUnder(SRC_DIR)) {
    if (file === VOCABULARIES_FILE) {
      continue;
    }
    const label = relative(SRC_DIR, file);
    for (const copy of scanFile(
      file,
      readFileSync(file, "utf8"),
      vocabularies
    )) {
      found.push(`${label}:${copy.line} names ${copy.vocabulary}`);
    }
  }
  return found.sort();
}
