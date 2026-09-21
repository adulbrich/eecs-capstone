import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The embedding backfill is two scripts, split by runtime rather than by
 * responsibility:
 *
 * - `scripts/backfill-embeddings.ts` runs on a workstation and calls the app's
 *   own `refreshProjectEmbedding`, so it has nothing to keep in sync.
 * - `scripts/backfill-embeddings.mjs` runs from the production image, which
 *   installs with `npm ci --omit=dev` (no `tsx`) and ships `.output` without
 *   `src/`. Nothing under `#/lib` resolves there, so it carries its own copy
 *   of what it needs.
 *
 * What crosses that boundary is whatever carries a `MUST match` comment in the
 * script, and the `it` names below are the inventory of which of those are
 * pinned. Keeping the list here rather than in prose anywhere else is
 * deliberate: a prose list goes stale and nothing fails when it does, which is
 * the same failure mode this file exists to prevent
 * ([ADR-0024](../../docs/adr/0024-ops-scripts-are-plain-mjs.md)).
 *
 * What is pinned is whatever drifts silently or expensively. Worst first:
 *
 * - The embedded text drifts. The script stores vectors computed from text the
 *   app would never produce for that project. Nothing errors, the stored hash
 *   still looks valid to the app, so nothing recomputes them, and
 *   recommendations quietly get worse.
 * - The rule that decides a row needs no work drifts. Silent in one direction
 *   and expensive in the other: lose the vector half and a row whose write was
 *   interrupted is skipped by every sweeper forever with nothing to say so;
 *   lose the hash half and every run re-embeds everything at one paid call
 *   each.
 * - The hash inputs drift, including the model id and dimension defaults.
 *   Every row looks stale to whichever side did not change, so both sides
 *   re-embed rows that were already correct at one paid Bedrock call each, and
 *   can flip-flop a row indefinitely.
 * - The query drifts from what the builder reads. A status added to
 *   `EMBEDDABLE_STATUSES` alone leaves rows the script never sweeps. A field
 *   added to `EmbeddableProject` alone is worse, because the body comparison
 *   below then forces the script's copied builder to read a key the query
 *   never selected, and `section` treats an absent key as an empty one, so the
 *   section silently vanishes from every string the script embeds.
 *
 * Copies whose drift is loud instead (`parseEmbedResponse`,
 * `buildBedrockConfig`, `toSqlVector`, `DEFAULT_REGION`) are deliberately not
 * pinned; the first two could not be anyway, since their TypeScript bodies
 * carry annotations an `.mjs` cannot hold.
 *
 * Read as text rather than imported, following `import-legacy-parity.test.ts`,
 * since importing the `.mjs` would run it and it expects a database.
 */
const SOURCE_FILE = readFileSync("src/lib/embedding-source.ts", "utf8");
const BEDROCK_FILE = readFileSync("src/lib/_internal/bedrock-embed.ts", "utf8");
const SCRIPT_FILE = readFileSync("scripts/backfill-embeddings.mjs", "utf8");

/**
 * The script with its comments removed, for the assertions a comment must not
 * be able to satisfy.
 *
 * Stripping comments by regex is unsafe in general, because a comment opener
 * inside a string literal makes it eat real code. Nothing here proves that
 * cannot happen, because an honest proof needs a parser: extracting the
 * literals from text that still holds comments is circular, since an
 * apostrophe in a comment opens one. What stands in for a proof is narrower
 * and testable, and the first `describe` below checks all three parts over
 * every stripped source: `backfill-embeddings.mjs`, `project-embeddings.ts`
 * and `embedding-source.ts`. None of them contains `://`, the sequence that
 * would put a `//` inside a string. Each strip is shown to run. The braces
 * still balance afterwards, which a swallowed run of code would almost
 * certainly break.
 *
 * The line strip is not anchored to the start of a line, so it also removes a
 * comment trailing real code. Nothing in the script does that today, and the
 * `://` check is what keeps the unanchored form safe.
 */
const SCRIPT_CODE = SCRIPT_FILE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/.*$/gm,
  ""
);

/**
 * `embedding-source.ts` with its comments stripped, for the same reason
 * `SCRIPT_CODE` exists: the negative pin below matches a call expression, and
 * a JSDoc explaining why that call is absent would otherwise satisfy it. Safe
 * on the same narrow grounds, and checked rather than claimed: the URL and
 * brace guards in the first `describe` run over this file too.
 */
const SOURCE_CODE = SOURCE_FILE.replace(/\/\*[\s\S]*?\*\//g, "").replace(
  /\/\/.*$/gm,
  ""
);
const LIMIT_PATTERN = /const EMBEDDING_SOURCE_LIMIT = ([0-9_]+);/;
const EMBEDDINGS_FILE = readFileSync(
  "src/server/_internal/project-embeddings.ts",
  "utf8"
);

/**
 * The same strip, applied to the `src/` side. Every other assertion against
 * `EMBEDDINGS_FILE` matches a declaration, which a comment cannot be, so the
 * raw text is safe for those. The skip pin below matches a statement, and
 * `refreshProjectEmbedding`'s JSDoc already quotes a fragment of it, which is
 * exactly the shape that satisfies a substring test without the code being
 * there at all.
 *
 * Safe for the same narrow reason as the script's strip, and by the same
 * assertions: the first `describe` below runs all three over every stripped
 * file, so "contains no `://`" and "braces still balance" are checks here
 * rather than claims.
 */
const EMBEDDINGS_CODE = EMBEDDINGS_FILE.replace(
  /\/\*[\s\S]*?\*\//g,
  ""
).replace(/\/\/.*$/gm, "");

const STATUS_SET_PATTERN =
  /const EMBEDDABLE_STATUSES: readonly ProjectStatus\[\] = \[([^\]]*)\]/;
const SQL_STATUS_PATTERN = /WHERE status IN \(([^)]*)\)/;
const INTERFACE_PATTERN = /export interface EmbeddableProject \{([\s\S]*?)\n\}/;
const SELECT_SQL_PATTERN = /const SELECT_SQL = `([^`]*)`/;

/** The quoted words inside a captured `[...]` or `(...)`, in source order. */
function quotedWords(inner: string | undefined, label: string): string[] {
  if (inner === undefined) {
    throw new Error(`Nothing to read in ${label}`);
  }
  return [...inner.matchAll(/["']([a-z_]+)["']/g)].map((match) => match[1]);
}

/**
 * Everything between `function <name>(...) {` and the closing brace, with
 * whitespace collapsed. The signatures differ by type annotations, so the body
 * is what compares, which means the compared bodies must stay free of
 * annotations and of comments: this collapses whitespace and strips neither.
 */
function functionBody(source: string, name: string, label: string): string {
  // Anchored rather than `indexOf("function " + name)`, which matches a longer
  // name starting with this one and matches the words inside a comment, either
  // of which silently compares the wrong body in the one test whose job is
  // catching silent drift. Every function it compares sits at column zero, so
  // the newline is what keeps it out of the JSDoc above it, and the `(` is
  // what stops `section` matching a later `sectionHeader`.
  const declaration = source.search(
    new RegExp(`\\n(?:export )?function ${name}\\s*\\(`)
  );
  if (declaration === -1) {
    throw new Error(`No function named ${name} in ${label}`);
  }
  const open = source.indexOf("{", declaration);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return source
          .slice(open + 1, i)
          .replace(/\s+/g, " ")
          .trim();
      }
    }
  }
  throw new Error(`Unbalanced braces in ${name} in ${label}`);
}

function bothBodies(name: string, src: string, srcLabel: string) {
  return [
    functionBody(src, name, srcLabel),
    functionBody(SCRIPT_FILE, name, "backfill-embeddings.mjs"),
  ];
}

/**
 * Not part of the inventory below. These prove the reading the inventory's
 * assertions depend on, and pin no copied declaration of their own.
 *
 * Every stripped file goes through all three, because a guard that covers
 * some of a set of identically stripped files is the prose-shaped assertion
 * this file exists to refuse.
 */
describe("reading the three stripped files as code rather than as text", () => {
  it.each([
    ["backfill-embeddings.mjs", SCRIPT_CODE],
    ["project-embeddings.ts", EMBEDDINGS_CODE],
    ["embedding-source.ts", SOURCE_CODE],
  ])("lose no brace in %s to the strip", (_label, code) => {
    // The cheap structural check: a strip that ate a run of real code almost
    // certainly takes a brace with it. Not a parser, and not claiming to be.
    const opens = code.match(/\{/g)?.length ?? 0;
    const closes = code.match(/\}/g)?.length ?? 0;
    expect(opens).toBe(closes);
    expect(opens).toBeGreaterThan(10);
  });

  /**
   * Structural, not textual. An earlier version looked for two particular
   * sentences, which meant rewording a comment quietly uncovered the strip it
   * was standing in for: the needle was gone, so `not.toContain` passed and
   * said nothing. These fail while any comment of either kind survives, and
   * the `toMatch` pair on the raw file fails if there was nothing to strip.
   *
   * The kept statement differs per file, so it is passed in: asserting only
   * that the strip removed things would pass on a strip that removed
   * everything.
   */
  it.each([
    [
      "backfill-embeddings.mjs",
      SCRIPT_FILE,
      SCRIPT_CODE,
      "await main();",
      true,
    ],
    [
      "project-embeddings.ts",
      EMBEDDINGS_FILE,
      EMBEDDINGS_CODE,
      "export async function refreshProjectEmbedding(",
      true,
    ],
    [
      "embedding-source.ts",
      SOURCE_FILE,
      SOURCE_CODE,
      "export function buildProjectEmbeddingSource(",
      false,
    ],
  ])(
    "lose every comment in %s and keep every statement",
    (_label, raw, code, kept, hasLineComment) => {
      // Every one of the three carries JSDoc, so the block strip always has
      // something to remove and the "there was something to strip" proof rests
      // on that. The line strip is different: `embedding-source.ts` is all
      // JSDoc and carries no `//` at all, and demanding one would be this file
      // inventing a rule about another file rather than describing one. So the
      // presence check is per-file and the removal check is not.
      expect(raw).toMatch(/\/\*/);
      if (hasLineComment) {
        expect(raw).toMatch(/^[ \t]*\/\//m);
      }
      expect(code).not.toMatch(/\/\*/);
      expect(code).not.toMatch(/\/\//);
      expect(code).toContain(kept);
    }
  );

  /**
   * What makes the unanchored line strip safe here, and the only assumption
   * the stripping rests on that a reader cannot see at a glance. A URL in a
   * string would put a `//` in code the strip then truncates, silently.
   *
   * It refuses a URL anywhere, including in a comment, where one would in fact
   * be harmless. That bluntness is deliberate: telling a comment from a string
   * is the job of the strip this assertion exists to protect, so doing it here
   * would be the circularity again. Every stripped file is scanned, so the
   * `src/` original is no longer the place to put a URL out of reach either.
   * A doc reference in any of the three spells the path or the ADR number
   * rather than a link, and the assertion is not to be deleted to get past
   * this. Every other file in the repo is untouched by it.
   */
  it.each([
    ["backfill-embeddings.mjs", SCRIPT_FILE],
    ["project-embeddings.ts", EMBEDDINGS_FILE],
    ["embedding-source.ts", SOURCE_FILE],
  ])("contains no URL in %s, in a string or anywhere else", (_label, raw) => {
    expect(raw).not.toContain("://");
  });
});

describe("the production backfill's copies of the embedding helpers", () => {
  it("assemble a section the same way", () => {
    const [fromSrc, fromScript] = bothBodies(
      "section",
      SOURCE_FILE,
      "embedding-source.ts"
    );
    expect(fromScript).toBe(fromSrc);
  });

  /**
   * The negative, pinned on both sides. ADR-0025 took the project's categories
   * and its program out of the embedded text, and putting either back is the
   * most expensive edit anybody can make to this string: every stored hash
   * stops matching at once and the next sweep re-embeds every project at one
   * paid call each. The body comparison below would notice a change on ONE side;
   * this notices a change applied to both, which is exactly how a section gets
   * reintroduced.
   */
  it("carry no Categories or Program section on either side", () => {
    for (const source of [SOURCE_CODE, SCRIPT_CODE]) {
      // The call, not the label: a formatter is free to wrap the arguments,
      // so anchoring on `section("Program"` with its argument on the same line
      // would pass the moment Biome broke the line. `section(` plus the label
      // in either order is what a reintroduced section cannot avoid.
      expect(source).not.toMatch(/section\(\s*"Program"/);
      expect(source).not.toMatch(/section\(\s*"Categories"/);
    }
  });

  /**
   * The whole body, not a sample of lines: the section labels, their order,
   * the blank line between them and the truncation all decide the text that
   * gets embedded, and a difference in any one of them is invisible at
   * runtime.
   */
  it("build the embedded text the same way", () => {
    const [fromSrc, fromScript] = bothBodies(
      "buildProjectEmbeddingSource",
      SOURCE_FILE,
      "embedding-source.ts"
    );
    expect(fromScript).toBe(fromSrc);
  });

  it("truncate the embedded text at the same length", () => {
    const fromSrc = LIMIT_PATTERN.exec(SOURCE_FILE)?.[1];
    const fromScript = LIMIT_PATTERN.exec(SCRIPT_FILE)?.[1];
    expect(fromSrc).toBe("20_000");
    expect(fromScript).toBe(fromSrc);
  });

  it("hash the source the same way", () => {
    const [fromSrc, fromScript] = bothBodies(
      "embeddingHash",
      SOURCE_FILE,
      "embedding-source.ts"
    );
    expect(fromScript).toBe(fromSrc);
  });

  /**
   * Pinned against a literal, not only against each other. Comparing the two
   * says they agree, which an edit applied to both satisfies: changing
   * `createHash("sha256")` to `"sha512"` in both files re-keys every project,
   * so the next run of either sweeper pays a Bedrock call for all 547 rows
   * that were already correct.
   *
   * Updating this string is the point. It is a deliberate step that says every
   * stored hash is about to stop matching.
   */
  it("hash the source by exactly the pinned construction", () => {
    const expected =
      'return createHash("sha256") ' +
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the pinned text of the template literal inside embeddingHash, not a template literal of its own. Interpolating it would defeat the pin.
      ".update(`${modelId}:${dimensions}:${source}`) " +
      '.digest("hex");';
    expect(
      functionBody(SOURCE_FILE, "embeddingHash", "embedding-source.ts")
    ).toBe(expected);
  });

  it("read the model id and dimensions the same way", () => {
    const [fromSrc, fromScript] = bothBodies(
      "buildEmbedConfig",
      BEDROCK_FILE,
      "bedrock-embed.ts"
    );
    expect(fromScript).toBe(fromSrc);
  });

  /**
   * Pinned for the same reason as the hash, and this one covers two hazards at
   * once. Both values are hashed into `embedding_source_hash`, so changing a
   * default on both sides re-keys every row; and `??` rather than `||` is the
   * documented wart that makes `BEDROCK_EMBEDDING_DIMENSIONS=""` yield zero
   * rather than 1024, which is the behavior the stored hashes were computed
   * with.
   */
  it("read the model id and dimensions by exactly the pinned construction", () => {
    const expected =
      "return { dimensions: " +
      'Number(env.BEDROCK_EMBEDDING_DIMENSIONS ?? "1024"), modelId: ' +
      'env.BEDROCK_EMBEDDING_MODEL_ID ?? "amazon.titan-embed-text-v2:0", };';
    expect(
      functionBody(BEDROCK_FILE, "buildEmbedConfig", "bedrock-embed.ts")
    ).toBe(expected);
  });

  it("build the Bedrock request body the same way", () => {
    const [fromSrc, fromScript] = bothBodies(
      "buildEmbedRequestBody",
      BEDROCK_FILE,
      "bedrock-embed.ts"
    );
    expect(fromScript).toBe(fromSrc);
  });

  /**
   * The script cannot import `EMBEDDABLE_STATUSES`, so it spells the set again
   * in SQL. Widening one side alone is silent: the app starts writing vectors
   * for a status the sweeper never selects, so every row already in that status
   * stays null forever and nothing says so.
   */
  it("sweep exactly the statuses the app embeds", () => {
    const fromSrc = quotedWords(
      STATUS_SET_PATTERN.exec(EMBEDDINGS_FILE)?.[1],
      "EMBEDDABLE_STATUSES in project-embeddings.ts"
    );
    const fromScript = quotedWords(
      SQL_STATUS_PATTERN.exec(SCRIPT_FILE)?.[1],
      "SELECT_SQL in backfill-embeddings.mjs"
    );
    expect(fromSrc).toEqual(["published", "archived"]);
    expect(fromScript).toEqual(fromSrc);
  });

  /**
   * The rule that decides a row needs no work. It is a copy like any other,
   * and drifting it is expensive in both directions: drop the hash half and
   * every run re-embeds all 547 at one paid call each; drop the
   * vector half and a row whose write was interrupted, carrying a current hash
   * beside a null vector, is skipped by every sweeper forever.
   *
   * Compared against a literal on each side rather than against each other,
   * because the two cannot be byte-identical: the app holds the vector it
   * selected and the script selects `embedding IS NOT NULL` as a boolean, so
   * it has no vector to test. Writing both out here is what makes that a
   * decision instead of a drift.
   *
   * Both sides read with their comments stripped, so neither can be satisfied
   * by prose quoting the expression.
   */
  it("agree on when a row needs no work", () => {
    expect(EMBEDDINGS_CODE).toContain(
      "if (project.embeddingSourceHash === hash && project.embedding) {"
    );
    expect(SCRIPT_CODE).toContain(
      "if (project.embeddingSourceHash === hash && project.hasEmbedding) {"
    );
  });

  /**
   * The script's half of the rule above reads `hasEmbedding`, which is not a
   * column. Nothing else would catch the query dropping it: `section` is not
   * involved, so the field pin below does not cover it, and an undefined
   * `project.hasEmbedding` makes the condition false, which reads as "this row
   * needs work" and re-embeds every row on every run at full price.
   */
  it("select the boolean the skip is built from", () => {
    const selectList = (SELECT_SQL_PATTERN.exec(SCRIPT_FILE)?.[1] ?? "").split(
      /\bfrom\b/i
    )[0];
    expect(selectList).toContain("SELECT");
    expect(selectList).toMatch(/embedding IS NOT NULL\s+AS "hasEmbedding"/);
    expect(selectList).toMatch(
      /embedding_source_hash\s+AS "embeddingSourceHash"/
    );
  });

  /**
   * The nastiest of the pins, because the body comparison above actively hides
   * this one. Add a field to `EmbeddableProject` and to the builder, and the
   * script's copied body has to read `project.newField` to stay byte-identical,
   * while nothing makes `SELECT_SQL` fetch that column. `section` reads the
   * absent key as an empty value and returns null, so the whole section drops
   * out of every string the script embeds, with no error and a hash the app
   * accepts as current.
   */
  it("select every field the embedded text is built from", () => {
    const interfaceBody = INTERFACE_PATTERN.exec(SOURCE_FILE)?.[1];
    expect(interfaceBody).toBeDefined();
    const keys = [
      ...(interfaceBody as string).matchAll(/^\s*(?:readonly )?(\w+)\s*[?:]/gm),
    ].map((match) => match[1]);
    // The exact set, not a floor. A key the regex silently stopped matching,
    // which `readonly` used to do, shrinks the coverage below with nothing to
    // say so, and a floor cannot tell that from a field being removed. Adding
    // a field to the interface is meant to fail here: it is the step that
    // sends you to `SELECT_SQL`.
    //
    // Sorted, because the declaration order is not a rule this repo has:
    // `useSortedTypeFields` is off (docs/QUIRKS.md), so reordering the
    // interface is legal and must not fail a test about coverage.
    expect([...keys].sort()).toEqual([
      "description",
      "licenseRestrictions",
      "minQualifications",
      "objectives",
      "prefQualifications",
      "problemStatement",
      "title",
    ]);

    // The select list alone, not the whole query: `id`, `status` and
    // `deleted_at` all appear in the WHERE clause, so a substring test over
    // the query would pass a field named after any of them without it ever
    // being selected.
    const selectList = (SELECT_SQL_PATTERN.exec(SCRIPT_FILE)?.[1] ?? "").split(
      /\bfrom\b/i
    )[0];
    // Guards the split, not the exec. A split that quietly failed to find its
    // delimiter leaves the whole query here, which is the vacuous pass this
    // test exists to avoid.
    expect(selectList).toContain("SELECT");
    expect(selectList).not.toMatch(/\bwhere\b/i);
    for (const key of keys) {
      // Either the column is already camelCase (`title`) or the query aliases
      // it to camelCase (`problem_statement AS "problemStatement"`), so the key
      // appears as a whole word either way.
      expect(selectList).toMatch(new RegExp(`\\b${key}\\b`));
    }
  });

  /**
   * Every pin above compares a declaration. None of them says the script
   * reaches it: inline a copied function at its call site and leave the
   * original sitting there unused, and its body pin still passes.
   *
   * Searched with the comments stripped, because ADR-0024 puts the
   * explanation of every copy in the JSDoc directly above it, which is exactly
   * where somebody writes `embeddingHash(source, modelId, dimensions)` in
   * prose and satisfies this check with no call anywhere.
   *
   * `section` is deliberately absent. Its only calls are inside
   * `buildProjectEmbeddingSource`, whose body is pinned byte for byte, so the
   * assertion could not fail independently of that pin: it would be the
   * vacuous pass this test is here to stop.
   */
  it.each([
    "buildProjectEmbeddingSource",
    "embeddingHash",
    "buildEmbedConfig",
    "buildEmbedRequestBody",
  ])("actually call their copy of %s", (name) => {
    const calls = SCRIPT_CODE.match(
      new RegExp(`(?<!function )\\b${name}\\(`, "g")
    );
    expect(calls?.length ?? 0).toBeGreaterThan(0);
  });

  /**
   * The `.mjs` only makes sense if the image actually carries it. The
   * `COPY scripts/...` line is hand-maintained, and a script missing from it
   * fails as "Cannot find module" inside a one-off ECS task, which is a
   * CloudWatch log nobody is watching at the time.
   */
  it("are shipped in the production image", () => {
    const dockerfile = readFileSync("Dockerfile", "utf8");
    expect(dockerfile).toContain("scripts/backfill-embeddings.mjs");
  });
});
