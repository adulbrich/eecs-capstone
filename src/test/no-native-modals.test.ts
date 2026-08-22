import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

describe("native browser modals", () => {
  it("are not used anywhere in src", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      // Skip both test locations. `src/lib/email/__tests__/templates.test.ts`
      // asserts on the XSS fixture string `onerror=alert(1)`, which any regex
      // looking for a native modal will match forever.
      if (
        file.includes("src/test/") ||
        file.includes("__tests__") ||
        file.includes(".test.")
      ) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      source.split("\n").forEach((line, i) => {
        const trimmed = line.trim();
        // Skip comment-only lines. The component that replaces confirm() has
        // to name it in its own documentation, so its JSDoc will always
        // contain the string being guarded against here.
        if (
          trimmed.startsWith("*") ||
          trimmed.startsWith("//") ||
          trimmed.startsWith("/*")
        ) {
          return;
        }
        // Match a bare call, not `.confirm(` on some object, and not the word
        // inside a longer identifier such as `confirmPassword(`. `window.` and
        // `globalThis.` are matched explicitly and on purpose: they are the
        // same global call as the bare form, just spelled with its receiver,
        // so the `[^.\w]` guard that excludes `someApi.confirm(` must not
        // also exclude these two.
        if (
          /(^|[^.\w])(?:(?:window|globalThis)\.)?(?:confirm|alert)\s*\(/.test(
            line
          )
        ) {
          offenders.push(`${file}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    expect(
      offenders,
      "Native confirm()/alert() block the main thread, ignore the brand and dark\n" +
        "palette, and cannot be scanned by axe. Use ConfirmDialog or a toast.\n\n" +
        offenders.join("\n")
    ).toEqual([]);
  });
});
