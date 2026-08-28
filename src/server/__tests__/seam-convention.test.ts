import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Enforces the `*As` first, `*ForCurrentUser` second convention documented in
 * `docs/QUIRKS.md`.
 *
 * This replaces a grep that could not fail. It printed every wrapper name
 * unconditionally and paired none of them, so a clean tree and a broken one
 * produced the same 59 lines. Six wrappers once shipped with no seam under
 * them, and the cost was exactly what the convention predicts: two bookmark
 * cases inserted rows directly because they could not reach the code, one
 * re-implemented the join it asserted on, the `canSeeProject` check on that
 * path had no coverage at all, and the two avatar tests sat in `describe.skip`.
 *
 * Reads source off disk rather than importing the modules, so it cannot be
 * broken by an import cycle and does not need a database.
 */

const INTERNAL_DIR = join(process.cwd(), "src/server/_internal");

/**
 * Matches every exported top-level binding, not just `function` declarations.
 * A wrapper written as `export const xForCurrentUser = async () => ...` has to
 * be seen too: a pattern that stops matching is how the grep this replaces
 * managed to pass on a tree it had never checked.
 */
const EXPORTED_BINDING =
  /export\s+(?:async\s+)?(?:function|const|let|var)\s+(\w+)/g;

const WRAPPER_SUFFIX = "ForCurrentUser";

function exportedNames(source: string): string[] {
  return [...source.matchAll(EXPORTED_BINDING)].map((match) => match[1]);
}

function internalFiles(): string[] {
  return readdirSync(INTERNAL_DIR).filter((name) => name.endsWith(".ts"));
}

function pairWrappersToSeams() {
  const wrappers: string[] = [];
  const unpaired: string[] = [];

  for (const file of internalFiles()) {
    const names = exportedNames(readFileSync(join(INTERNAL_DIR, file), "utf8"));
    const seams = new Set(names.filter((name) => /(?:As|Impl)$/.test(name)));

    for (const wrapper of names.filter((name) =>
      name.endsWith(WRAPPER_SUFFIX)
    )) {
      wrappers.push(`${file}: ${wrapper}`);
      const stem = wrapper.slice(0, -WRAPPER_SUFFIX.length);
      if (!(seams.has(`${stem}As`) || seams.has(`${stem}Impl`))) {
        unpaired.push(`${file}: ${wrapper}`);
      }
    }
  }

  return { wrappers, unpaired };
}

describe("the *As / *Impl seam convention", () => {
  it("finds wrappers to check, so a regex that stops matching fails loudly", () => {
    // Without this, deleting the convention or breaking the pattern above
    // leaves a test that passes because it examined nothing. That is the
    // failure mode this file exists to remove, so it is asserted first.
    expect(pairWrappersToSeams().wrappers.length).toBeGreaterThan(50);
  });

  it("gives every wrapper a same-stem seam in the same file", () => {
    // Names the wrappers rather than reporting a count: the message is the
    // whole point, since the fix is to add a seam to the ones listed.
    expect(pairWrappersToSeams().unpaired).toEqual([]);
  });
});
