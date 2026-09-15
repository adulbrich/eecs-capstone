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
 * Five declarations cross that boundary, and each fails silently or expensively
 * if the copies drift (#427):
 *
 * - `EMBEDDING_SOURCE_LIMIT`, `section` and `buildProjectEmbeddingSource`
 *   assemble the exact text that gets embedded. Drift stores vectors computed
 *   from text the app would never produce for that project. Nothing errors, the
 *   stored hash still looks valid to the app, so nothing recomputes them, and
 *   recommendations quietly get worse. The only silent failure of the three.
 * - `embeddingHash` decides whether a project needs re-embedding. Drift in its
 *   inputs makes every row look stale to whichever side did not change, so both
 *   sides re-embed rows that were already correct at one paid Bedrock call
 *   each, and can flip-flop a row indefinitely.
 * - `buildEmbedConfig` carries the model id and dimension defaults, which are
 *   themselves hash inputs. A dimension change is loud, since pgvector rejects
 *   a vector that is not 1024 wide, but a model id change is not.
 *
 * Nothing else would catch any of them: the two run months apart, by different
 * people, and the `.mjs` runs where no test does.
 *
 * Deliberately not compared: `parseEmbedResponse` and `buildBedrockConfig`.
 * Their TypeScript bodies carry a cast and a typed return that an `.mjs`
 * cannot hold, and drift in either is loud, a throw or a connection failure
 * rather than a wrong vector.
 *
 * Read as text rather than imported, following `import-legacy-parity.test.ts`,
 * since importing the `.mjs` would run it and it expects a database.
 */
const SOURCE_FILE = readFileSync("src/lib/embedding-source.ts", "utf8");
const BEDROCK_FILE = readFileSync("src/lib/_internal/bedrock-embed.ts", "utf8");
const SCRIPT_FILE = readFileSync("scripts/backfill-embeddings.mjs", "utf8");
const LIMIT_PATTERN = /const EMBEDDING_SOURCE_LIMIT = ([0-9_]+);/;

/**
 * Everything between `function <name>(...) {` and the closing brace, with
 * whitespace collapsed. The signatures differ by type annotations, so the body
 * is what compares, which means the compared bodies must stay free of
 * annotations and of comments: this collapses whitespace and strips neither.
 */
function functionBody(source: string, name: string, label: string): string {
  const declaration = source.indexOf(`function ${name}`);
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
    expect(fromSrc).toBe("45_000");
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
