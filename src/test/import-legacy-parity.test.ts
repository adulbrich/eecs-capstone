import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * `scripts/import-legacy.ts` and `scripts/import-legacy.mjs` are deliberate
 * near-duplicates: the `.mjs` exists because the production image installs
 * with `--omit=dev` (no `tsx`) and ships `.output` without `src/`, so the
 * TypeScript one cannot run there.
 *
 * Duplication is the accepted cost; silent divergence is not. Several blocks
 * MUST agree, and nothing else would catch them drifting: the two files are
 * run months apart, against different databases, by different people.
 *
 * `NAMESPACE` is the worst case. Every imported row's primary key and every
 * image storage key derives from it, so a change in one file re-keys all 547
 * rows and orphans every object already in the bucket.
 *
 * `PROGRAMS` is the subtlest. A `courseId` edited in one file and not the
 * other attaches 181 projects to the wrong campus, with no error anywhere.
 *
 * This follows `env-contract.test.ts`: read the sources as text and assert
 * the literals match, rather than importing modules that expect a database.
 */
const TS_SOURCE = readFileSync("scripts/import-legacy.ts", "utf8");
const MJS_SOURCE = readFileSync("scripts/import-legacy.mjs", "utf8");

/** The body of a top-level `const <name> = { ... };`, whitespace collapsed. */
function objectLiteral(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = {`);
  if (start === -1) {
    throw new Error(`No object literal named ${name}`);
  }
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(open, i + 1).replace(/\s+/g, " ");
      }
    }
  }
  throw new Error(`Unbalanced braces in ${name}`);
}

describe("import-legacy.ts and import-legacy.mjs agree", () => {
  it("derives row ids from the same UUIDv5 namespace", () => {
    const pattern = /const NAMESPACE = "([0-9a-f-]{36})";/;
    const fromTs = pattern.exec(TS_SOURCE)?.[1];
    const fromMjs = pattern.exec(MJS_SOURCE)?.[1];
    expect(fromTs).toBeDefined();
    expect(fromMjs).toBe(fromTs);
  });

  it("maps every legacy course onto the same program", () => {
    expect(objectLiteral(MJS_SOURCE, "PROGRAMS")).toBe(
      objectLiteral(TS_SOURCE, "PROGRAMS")
    );
  });

  it("accepts the same target statuses", () => {
    const pattern = /const IMPORTABLE_STATUSES = (\[[^\]]*\])/;
    const fromTs = pattern.exec(TS_SOURCE)?.[1].replace(/\s+/g, " ");
    const fromMjs = pattern.exec(MJS_SOURCE)?.[1].replace(/\s+/g, " ");
    expect(fromTs).toBeDefined();
    expect(fromMjs).toBe(fromTs);
  });

  /**
   * A fixed vector, so a change to either `uuidv5` body is caught even though
   * the two implementations are written in different dialects and cannot be
   * compared as text. Computed the same way both files do it: the namespace
   * bytes, then the name, SHA-1, with the version and variant bits forced.
   */
  it("turns a known cp_id into a known project id", () => {
    const namespace = /const NAMESPACE = "([0-9a-f-]{36})";/.exec(
      TS_SOURCE
    )?.[1] as string;
    const ns = Buffer.from(namespace.replaceAll("-", ""), "hex");
    const hash = createHash("sha1")
      .update(Buffer.concat([ns, Buffer.from("Qlp7QCpPLveoERMn", "utf8")]))
      .digest();
    // The scripts write these as `(h & 0x0f) | 0x50` and `(h & 0x3f) | 0x80`.
    // Spelled with arithmetic here because Biome forbids bitwise operators in
    // `src/`, and the two forms are exactly equal: the mask is a modulo, and
    // the set bits of 0x50 and 0x80 lie above the masked range, so the OR is
    // an addition.
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
    // The id legacy cp_id "Qlp7QCpPLveoERMn" ("Know It's Off") already
    // carries in an imported database. If this changes, every imported row is
    // re-keyed and every image object in the bucket is orphaned.
    expect(id).toBe("40eb1fdf-97d2-5b09-92d6-e61e96059deb");
  });
});
