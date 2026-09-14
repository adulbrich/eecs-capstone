import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The legacy import is two scripts, split by responsibility rather than by
 * runtime:
 *
 * - `scripts/import-legacy-images.ts` converts the images. Workstation only,
 *   because it reuses the app's `processImage` and `projectImageKeys`, which
 *   the production container does not ship (`npm ci --omit=dev` leaves no
 *   `tsx`, and the image carries `.output` without `src/`).
 * - `scripts/import-legacy.mjs` is the only thing that writes to the
 *   database, and runs anywhere.
 *
 * Three things cross that boundary and cannot be imported across it, so each
 * is written out twice and each fails silently if the copies drift:
 *
 * - `NAMESPACE`. A project's row id and the prefix of its image key both
 *   derive from it, so a differing value writes every object under a key no
 *   imported row points at.
 * - The `uuidv5` body. Same consequence, reached a different way.
 * - The `image-keys.json` filename. The importer treats an unreadable key map
 *   as "the image step has not run yet", which is legal, so a drifted name
 *   lands all 547 rows with no image and no error.
 *
 * Nothing else would catch any of them: the two run months apart, by
 * different people.
 *
 * Read as text rather than imported, following `env-contract.test.ts`, since
 * importing either module expects a database or object storage.
 */
const IMAGES_SOURCE = readFileSync("scripts/import-legacy-images.ts", "utf8");
const IMPORT_SOURCE = readFileSync("scripts/import-legacy.mjs", "utf8");
const NAMESPACE_PATTERN = /const NAMESPACE = "([0-9a-f-]{36})";/;

/**
 * Everything between `function uuidv5(...) {` and the closing brace, with
 * whitespace collapsed. The signatures differ by a type annotation, so the
 * body is what compares.
 */
function uuidv5Body(source: string, label: string): string {
  const declaration = source.indexOf("function uuidv5");
  if (declaration === -1) {
    throw new Error(`No function named uuidv5 in ${label}`);
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
  throw new Error(`Unbalanced braces in uuidv5 in ${label}`);
}

describe("the legacy import's two scripts", () => {
  it("derive ids from the same UUIDv5 namespace", () => {
    const fromImages = NAMESPACE_PATTERN.exec(IMAGES_SOURCE)?.[1];
    const fromImport = NAMESPACE_PATTERN.exec(IMPORT_SOURCE)?.[1];
    expect(fromImages).toBeDefined();
    expect(fromImport).toBe(fromImages);
  });

  /**
   * The whole body, not a sample of lines. An earlier version of this test
   * asserted four lines and passed while the two spelled the first one
   * differently (`replace(/-/g, "")` against `replaceAll("-", "")`), because
   * the shorter string is a prefix of the longer.
   */
  it("derive ids by the same construction", () => {
    expect(uuidv5Body(IMAGES_SOURCE, "import-legacy-images.ts")).toBe(
      uuidv5Body(IMPORT_SOURCE, "import-legacy.mjs")
    );
  });

  /**
   * Comparing the two to each other says they agree, not that they are right:
   * an edit applied to both passes. These pin the construction itself, so the
   * known-answer test below stays anchored to something the sources actually
   * contain rather than to a constant this file alone repeats.
   */
  it("derive ids by the construction the fixed vector assumes", () => {
    for (const source of [IMAGES_SOURCE, IMPORT_SOURCE]) {
      expect(source).toContain('NAMESPACE.replaceAll("-", "")');
      expect(source).toContain(
        '.update(Buffer.concat([ns, Buffer.from(name, "utf8")]))'
      );
      expect(source).toContain("hash[6] = (hash[6] & 0x0f) | 0x50;");
      expect(source).toContain("hash[8] = (hash[8] & 0x3f) | 0x80;");
    }
  });

  it("agree on the name of the key map file", () => {
    expect(IMAGES_SOURCE).toContain('"image-keys.json"');
    expect(IMPORT_SOURCE).toContain('"image-keys.json"');
  });

  /**
   * A regression pin, independent of both sources: it recomputes the id here
   * and compares to the value an imported database already holds. It does NOT
   * execute either script, so it is the assertions above that tie it to what
   * the scripts really do.
   */
  it("turn a known cp_id into a known project id", () => {
    const namespace = NAMESPACE_PATTERN.exec(IMPORT_SOURCE)?.[1] as string;
    const ns = Buffer.from(namespace.replaceAll("-", ""), "hex");
    const hash = createHash("sha1")
      .update(Buffer.concat([ns, Buffer.from("Qlp7QCpPLveoERMn", "utf8")]))
      .digest();
    // The scripts write these as `(h & 0x0f) | 0x50` and `(h & 0x3f) | 0x80`.
    // Spelled with arithmetic because Biome forbids bitwise operators in
    // `src/`, and the forms are exactly equal: the mask is a modulo, and the
    // set bits of 0x50 and 0x80 lie above the masked range, so the OR adds.
    hash[6] = (hash[6] % 0x10) + 0x50;
    hash[8] = (hash[8] % 0x40) + 0x80;
    const hex = hash.subarray(0, 16).toString("hex");
    const id = [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20, 32),
    ].join("-");
    // The id legacy cp_id "Qlp7QCpPLveoERMn" ("Know It's Off") already carries
    // in an imported database. If this changes, every imported row is re-keyed
    // and every image object in the bucket is orphaned.
    expect(id).toBe("40eb1fdf-97d2-5b09-92d6-e61e96059deb");
  });
});
