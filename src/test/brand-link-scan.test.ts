import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Where `text-brand` may still appear, so that a link cannot pick it up again.
 *
 * Beaver Orange is 4.56:1 on white and under AA on the page surface and on
 * every tint, which is why #357 and #358 moved every brand link to
 * `text-brand-dark` and UI-CONVENTIONS "Color tokens" calls the lighter one
 * on a link a regression. A rule in a doc is remembered; this is the part
 * that is enforced. The allow list is the one decorative use, an icon tile
 * with no text in it, and a genuine new decoration is added here with the
 * reason beside it.
 */
const DECORATIVE_USES = new Set([
  // The landing page's icon tile: a lucide glyph on the brand tint, no text.
  "src/routes/index.tsx",
]);

const SRC_DIR = join(process.cwd(), "src");

/** `text-brand` on its own: `text-brand-dark` and `text-brand-light` pass. */
const BARE_BRAND = /\btext-brand\b(?!-)/;

function* componentFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "test") {
        yield* componentFiles(path);
      }
    } else if (entry.name.endsWith(".tsx")) {
      yield path;
    }
  }
}

function filesUsingBareBrand(): string[] {
  const hits: string[] = [];
  for (const path of componentFiles(SRC_DIR)) {
    if (BARE_BRAND.test(readFileSync(path, "utf8"))) {
      hits.push(relative(process.cwd(), path));
    }
  }
  return hits.sort();
}

describe("brand links", () => {
  it("no component outside the decorative allow list uses text-brand", () => {
    const hits = filesUsingBareBrand();
    const unexpected = hits.filter((file) => !DECORATIVE_USES.has(file));
    expect(
      unexpected,
      "A link needs text-brand-dark (UI-CONVENTIONS, Color tokens); a decoration goes in DECORATIVE_USES with its reason"
    ).toEqual([]);
    // The other direction: an allow-listed file that no longer needs the
    // exemption should lose it, so the list cannot grow stale.
    expect([...DECORATIVE_USES].filter((file) => !hits.includes(file))).toEqual(
      []
    );
  });

  // The matcher itself, against strings written to fool it. A scan that
  // agrees with the tree proves nothing about what it would notice.
  it("matches the bare token and not its dark or light sibling", () => {
    expect(BARE_BRAND.test('className="text-brand hover:underline"')).toBe(
      true
    );
    expect(BARE_BRAND.test('className="border-brand text-brand"')).toBe(true);
    expect(BARE_BRAND.test('className="text-brand-dark hover:underline"')).toBe(
      false
    );
    expect(BARE_BRAND.test('className="bg-brand text-brand-light"')).toBe(
      false
    );
  });
});
