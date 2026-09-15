import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Error text comes through `errorMessage`, never a cast.
 *
 * A `catch` binding is `unknown`, so `(err as Error).message` is a lie the
 * compiler cannot check: a server function can reject with anything, and an
 * `Error` with an empty message renders an empty paragraph, which is what
 * `src/lib/error-message.ts` exists to stop. Twenty-one sites cast anyway while
 * twenty-nine already used the helper (#410).
 *
 * A comment may name the cast, because the helper's own documentation has to
 * say what it replaces, the way `no-native-modals.test.ts` allows for the same
 * reason.
 */

const SRC_DIR = join(process.cwd(), "src");
const CAST = /\(\s*\w+\s+as\s+Error\s*\)\s*\.\s*message/;

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Test files may cast: a test that throws an Error knows it threw one.
      if (path !== join(SRC_DIR, "test") && entry.name !== "__tests__") {
        yield* sourceFiles(path);
      }
    } else if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.includes(".test.")
    ) {
      yield path;
    }
  }
}

function isComment(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.startsWith("*") ||
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*")
  );
}

describe("error extraction", () => {
  it("goes through errorMessage rather than a cast", () => {
    const offenders: string[] = [];
    for (const path of sourceFiles(SRC_DIR)) {
      const source = readFileSync(path, "utf8");
      source.split("\n").forEach((line, i) => {
        if (!isComment(line) && CAST.test(line)) {
          offenders.push(
            `${relative(process.cwd(), path)}:${i + 1}: ${line.trim()}`
          );
        }
      });
    }
    expect(
      offenders,
      "A catch binding is unknown, and an Error with an empty message renders\n" +
        "nothing. Use errorMessage(err, fallback) from src/lib/error-message.ts\n" +
        '(UI-CONVENTIONS, "Mutations and feedback").\n\n' +
        offenders.join("\n")
    ).toEqual([]);
  });

  it("matches the cast in its spellings and not a mention of it", () => {
    expect(CAST.test("setError((err as Error).message);")).toBe(true);
    expect(CAST.test("setError((e as Error).message)")).toBe(true);
    expect(CAST.test("const m = ( error as Error ).message;")).toBe(true);
    expect(CAST.test('errorMessage(err, "Save failed")')).toBe(false);
    expect(CAST.test("if (err instanceof Error && err.message) {")).toBe(false);
    expect(
      isComment(" * `(e as Error).message` verbatim, so these strings")
    ).toBe(true);
    expect(isComment("      setError((err as Error).message);")).toBe(false);
  });
});
