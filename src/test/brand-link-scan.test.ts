import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { classStrings } from "./shared/class-strings";

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
  "src/routes/_public/index.tsx",
]);

const SRC_DIR = join(process.cwd(), "src");
// Compared by full path, not by name, for the reason `vocabulary-scan.ts`
// gives: a bare-name check would exempt any directory called `test` anywhere
// under `src/`, a production one included, and would do so silently.
const TEST_DIR = join(SRC_DIR, "test");

/** `text-brand` on its own: `text-brand-dark` and `text-brand-light` pass. */
const BARE_BRAND = /\btext-brand\b(?!-)/;

/**
 * Files whose underline is not a link's, with the reason.
 *
 * The global `a` rule sets the offset for anchors, which is why a call site
 * restating it is noise; the `link` Button variant is a `<button>` as often as
 * an anchor, so it has to set its own.
 */
const UNDERLINE_EXEMPT = new Map([
  [
    "src/components/ui/button.tsx",
    "the `link` variant renders a <button> as well as an anchor, so the global `a` rule does not reach it",
  ],
]);

/**
 * A class string that turns an underline on.
 *
 * `underline` alone, not `hover:underline` (which is the whole-cell rule, a
 * different thing), not `no-underline`, and not `underline-offset-2` or
 * `decoration-*`, which are the line's shape rather than its presence.
 */
const TURNS_UNDERLINE_ON = /(?<![\w:-])underline(?![\w-])/;
/**
 * The global `a` rule owns the offset, so a call site restating it is noise.
 *
 * Banned everywhere rather than only on an anchor, because a scan cannot tell
 * which element a class string lands on. Something that is not a link and has
 * its own reason to set an offset goes in `UNDERLINE_EXEMPT` with that reason,
 * as the `link` Button variant does.
 */
const RESTATES_OFFSET = /\bunderline-offset-/;

function* componentFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== TEST_DIR && entry.name !== "__tests__") {
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

  /**
   * The half of the running-text rule a regex can decide.
   *
   * Whether a link sits in a paragraph or fills a table cell is not something
   * a scan can tell, so it cannot say where `underline` belongs. It can say
   * that a class string turning the line on carries the colour with it: the
   * thirteen links #411 fixed had a bare `underline` and no colour class at
   * all, which is exactly what `BARE_BRAND` could not see, and they hovered to
   * the vivid orange that rule exists to keep off a link.
   */
  it("no class string underlines without carrying text-brand-dark", () => {
    const offenders: string[] = [];
    for (const path of componentFiles(SRC_DIR)) {
      const file = relative(process.cwd(), path);
      if (UNDERLINE_EXEMPT.has(file)) {
        continue;
      }
      const source = readFileSync(path, "utf8");
      for (const { all, unconditional } of classStrings(source)) {
        // The underline is read from every literal, because one applied
        // conditionally still underlines; the colour is read from the
        // unconditional ones, because `cn("underline", on && "text-brand-dark")`
        // renders a bare underline whenever `on` is false, which is the defect
        // this rule exists to stop.
        if (
          TURNS_UNDERLINE_ON.test(all) &&
          !unconditional.includes("text-brand-dark")
        ) {
          offenders.push(`${file}: ${all}`);
        }
        if (RESTATES_OFFSET.test(all)) {
          offenders.push(`${file}: ${all} restates the global offset`);
        }
      }
    }
    expect(
      offenders,
      "A link underlined at rest carries text-brand-dark, and the global `a`\n" +
        'rule owns the offset (UI-CONVENTIONS, "A link inside running text is\n' +
        'underlined at rest").\n\n' +
        offenders.join("\n")
    ).toEqual([]);
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

  it("tells a rest underline from a hover one, an offset or a negation", () => {
    expect(TURNS_UNDERLINE_ON.test("underline")).toBe(true);
    expect(TURNS_UNDERLINE_ON.test("text-brand-dark underline")).toBe(true);
    expect(
      TURNS_UNDERLINE_ON.test("break-all underline underline-offset-2")
    ).toBe(true);
    expect(TURNS_UNDERLINE_ON.test("hover:underline")).toBe(false);
    expect(TURNS_UNDERLINE_ON.test("no-underline")).toBe(false);
    expect(TURNS_UNDERLINE_ON.test("underline-offset-2")).toBe(false);
    expect(TURNS_UNDERLINE_ON.test("decoration-2")).toBe(false);
    expect(TURNS_UNDERLINE_ON.test("group-hover:underline")).toBe(false);
  });

  // A cn() call is one class string, not several: split per literal, a
  // correctly coloured `cn("underline", "text-brand-dark")` would be reported
  // for the half that has no colour in it. A colour behind a condition is a
  // colour the element sometimes lacks, which is why the two readings differ.
  it("separates what a class string always carries from what it can carry", () => {
    expect([
      ...classStrings('<Link className="underline" to="/x">y</Link>'),
    ]).toEqual([{ all: "underline", unconditional: "underline" }]);
    expect([
      ...classStrings('<a className={cn("underline", "text-brand-dark")}>'),
    ]).toEqual([
      {
        all: "underline text-brand-dark",
        unconditional: "underline text-brand-dark",
      },
    ]);
    expect([
      ...classStrings(
        '<a className={cn("underline", on && "text-brand-dark")}>'
      ),
    ]).toEqual([
      { all: "underline text-brand-dark", unconditional: "underline" },
    ]);
    expect([...classStrings("<a className={passedIn}>")]).toEqual([]);
  });

  it("flags a colour that only some renders carry", () => {
    const conditional = [
      ...classStrings(
        '<a className={cn("underline", on && "text-brand-dark")}>'
      ),
    ][0];
    expect(TURNS_UNDERLINE_ON.test(conditional.all)).toBe(true);
    expect(conditional.unconditional.includes("text-brand-dark")).toBe(false);
  });
});
