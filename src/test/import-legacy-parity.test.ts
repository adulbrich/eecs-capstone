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
 * They share exactly one thing, and it is load-bearing: `NAMESPACE`. A
 * project's row id and the prefix of its image key both derive from it, so a
 * value that differed between the two would write every object under a key no
 * imported row points at, with no error anywhere. Nothing else would catch it:
 * the two run months apart, by different people.
 *
 * Read as text rather than imported, following `env-contract.test.ts`, since
 * importing either module expects a database or object storage.
 */
const IMAGES_SOURCE = readFileSync("scripts/import-legacy-images.ts", "utf8");
const IMPORT_SOURCE = readFileSync("scripts/import-legacy.mjs", "utf8");
const NAMESPACE_PATTERN = /const NAMESPACE = "([0-9a-f-]{36})";/;

describe("the legacy import's two scripts", () => {
  it("derive ids from the same UUIDv5 namespace", () => {
    const fromImages = NAMESPACE_PATTERN.exec(IMAGES_SOURCE)?.[1];
    const fromImport = NAMESPACE_PATTERN.exec(IMPORT_SOURCE)?.[1];
    expect(fromImages).toBeDefined();
    expect(fromImport).toBe(fromImages);
  });

  /**
   * The two `uuidv5` bodies differ only in a type annotation, so the lines
   * that matter compare directly as text. Named individually rather than
   * diffed whole: these four are the ones whose divergence is silent, where a
   * changed hash input or a wrong version nibble yields a valid-looking uuid
   * that simply addresses nothing.
   */
  it("derive ids by the same construction", () => {
    for (const line of [
      "const ns = Buffer.from(NAMESPACE.replace",
      '.update(Buffer.concat([ns, Buffer.from(name, "utf8")]))',
      "hash[6] = (hash[6] & 0x0f) | 0x50;",
      "hash[8] = (hash[8] & 0x3f) | 0x80;",
    ]) {
      expect(IMAGES_SOURCE, `import-legacy-images.ts: ${line}`).toContain(line);
      expect(IMPORT_SOURCE, `import-legacy.mjs: ${line}`).toContain(line);
    }
  });

  /**
   * A regression pin on the whole construction, independent of both sources:
   * it recomputes the id here and compares to the value an imported database
   * already holds. It does NOT execute either script, so it catches a changed
   * algorithm only together with the text assertions above.
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
