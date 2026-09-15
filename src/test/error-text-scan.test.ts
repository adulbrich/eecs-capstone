import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * One error paragraph, not forty.
 *
 * `FieldError` renders `text-destructive text-sm` with a margin and a
 * `role="alert"`. About forty call sites wrote that paragraph by hand instead
 * and drifted apart on margin and size, and all but two said nothing to a
 * screen reader (#411). A rule in a doc is remembered; this is the part that
 * is enforced, in the style of `no-native-modals.test.ts`.
 *
 * It cannot see a paragraph whose classes are assembled somewhere else, and it
 * does not try: what it catches is the literal shape that was copied around.
 */

const SRC_DIR = join(process.cwd(), "src");
// Compared by full path, not by name, for the reason `brand-link-scan.ts`
// gives: a bare-name check would exempt any directory called `test` anywhere
// under `src/`, a production one included, and would do so silently.
const TEST_DIR = join(SRC_DIR, "test");
const UI_DIR = join(SRC_DIR, "components", "ui");

/**
 * The files that may still carry destructive body text, with the reason.
 *
 * `src/components/ui/` is exempt wholesale: `FieldError` is the paragraph this
 * rule points at, so it has to contain it.
 */
const ALLOWED = new Map([
  [
    "src/components/error-banner.tsx",
    "the banner form of the same message, one component for the three copies that existed",
  ],
  [
    "src/components/ban-form.tsx",
    "a status panel, not a failed action: a section with a heading, a reason and an expiry, describing the state the account is in",
  ],
  [
    "src/routes/_authed/profile.tsx",
    "FormFeedback is an <output>, which announces politely as a status already, and says Saved and Password changed from the same element; #410 owns how that page reports a result",
  ],
  [
    "src/routes/_authed/admin/projects/index.tsx",
    "a badge on a table row marking a soft-deleted project, not a message about an action",
  ],
]);

/**
 * `text-destructive` beside a text size, which is the error-paragraph shape.
 *
 * Order-independent, because the copies wrote it both ways round. The `(?!-)`
 * matters: `text-destructive-foreground` is the ink on a filled destructive
 * surface, which is what the notification bell's unread badge uses, and that is
 * a badge rather than a message about an action.
 */
const DESTRUCTIVE = String.raw`\btext-destructive\b(?!-)`;
const SIZE = String.raw`\btext-(?:xs|sm|base)\b`;
const DESTRUCTIVE_TEXT = new RegExp(
  `${DESTRUCTIVE}[^"'\`]*${SIZE}|${SIZE}[^"'\`]*${DESTRUCTIVE}`
);

function* componentFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== TEST_DIR && entry.name !== "__tests__") {
        yield* componentFiles(path);
      }
    } else if (entry.name.endsWith(".tsx") && !entry.name.includes(".test.")) {
      yield path;
    }
  }
}

describe("error text", () => {
  it("is not hand-written outside the primitives and the allow list", () => {
    const offenders: string[] = [];
    for (const path of componentFiles(SRC_DIR)) {
      if (path.startsWith(UI_DIR)) {
        continue;
      }
      const file = relative(process.cwd(), path);
      if (ALLOWED.has(file)) {
        continue;
      }
      const source = readFileSync(path, "utf8");
      source.split("\n").forEach((line, i) => {
        if (DESTRUCTIVE_TEXT.test(line)) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "Error text goes through FieldError or ErrorBanner, which announce it\n" +
        'and carry one margin (UI-CONVENTIONS, "Error text goes through one\n' +
        'component"). A genuine non-error use goes in ALLOWED with its reason.\n\n' +
        offenders.join("\n")
    ).toEqual([]);

    // The other direction: an allow-listed file that no longer needs the
    // exemption should lose it, so the list cannot grow stale.
    const stale = [...ALLOWED.keys()].filter(
      (file) =>
        !DESTRUCTIVE_TEXT.test(readFileSync(join(process.cwd(), file), "utf8"))
    );
    expect(stale).toEqual([]);
  });

  // The matcher itself, against strings written to fool it.
  it("matches the paragraph's shape in either order and not a bare token", () => {
    expect(DESTRUCTIVE_TEXT.test('className="text-destructive text-sm"')).toBe(
      true
    );
    expect(
      DESTRUCTIVE_TEXT.test('className="mt-2 text-destructive text-xs"')
    ).toBe(true);
    expect(DESTRUCTIVE_TEXT.test('className="text-sm text-destructive"')).toBe(
      true
    );
    // A colour on its own is a badge, an icon or a focus ring, not this shape.
    expect(DESTRUCTIVE_TEXT.test('className="text-destructive"')).toBe(false);
    expect(
      DESTRUCTIVE_TEXT.test('className="border-destructive text-sm"')
    ).toBe(false);
    expect(DESTRUCTIVE_TEXT.test('variant="destructive"')).toBe(false);
    // The ink on a filled destructive surface, which is a badge, not a message.
    expect(
      DESTRUCTIVE_TEXT.test(
        'className="bg-destructive text-destructive-foreground text-xs"'
      )
    ).toBe(false);
    // Two separate strings in one cn() are two class strings, not one line.
    expect(
      DESTRUCTIVE_TEXT.test('cn("text-sm", "text-muted-foreground")')
    ).toBe(false);
  });
});
