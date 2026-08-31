import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  assertImageFile,
  IMAGE_FILE_ACCEPT,
  MAX_IMAGE_BYTES,
} from "../image-upload-policy";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return walk(full);
    }
    return full.endsWith(".tsx") || full.endsWith(".ts") ? [full] : [];
  });
}

function file(type: string, bytes = 8): File {
  return new File([new Uint8Array(bytes)], "x", { type });
}

describe("assertImageFile", () => {
  it("accepts every type on the allowlist", () => {
    for (const type of ALLOWED_IMAGE_TYPES) {
      expect(() => assertImageFile(file(type))).not.toThrow();
    }
  });

  it("rejects a value that is not a File", () => {
    expect(() => assertImageFile(null)).toThrow(/Missing file/);
    expect(() => assertImageFile("not a file")).toThrow(/Missing file/);
  });

  it("rejects a type off the allowlist", () => {
    expect(() => assertImageFile(file("text/plain"))).toThrow(
      /Unsupported image type/
    );
    expect(() => assertImageFile(file("image/svg+xml"))).toThrow(
      /Unsupported image type/
    );
  });

  it("rejects a file over the cap, and accepts one exactly at it", () => {
    expect(() =>
      assertImageFile(file("image/png", MAX_IMAGE_BYTES + 1))
    ).toThrow(new RegExp(`File too large \\(max ${MAX_IMAGE_BYTES} bytes\\)`));
    expect(() =>
      assertImageFile(file("image/png", MAX_IMAGE_BYTES))
    ).not.toThrow();
  });
});

describe("IMAGE_FILE_ACCEPT", () => {
  // Not asserted against the allowlist: it is derived from it, so that
  // agreement cannot break. The drift this module exists to stop is a fourth
  // surface writing the types out again, which is what the scan below reads
  // source off disk to catch. `no-native-modals.test.ts` does the same thing
  // for the same reason.
  it("renders the allowlist as one comma-separated attribute value", () => {
    // Pinned as a literal rather than rebuilt from the Set: what a picker
    // shows is the string, and a changed separator or a lost type is a
    // silently narrower picker.
    expect(IMAGE_FILE_ACCEPT).toBe("image/jpeg,image/png,image/webp,image/gif");
  });

  it("is the only image allowlist src spells out", () => {
    // Two rules, because there are two shapes the drift takes and neither
    // catches the other. A hand-written allowlist is always two or more MIME
    // types together, wherever it is assigned: an earlier version matched
    // only next to `accept=`, and a `const LOCAL = "image/jpeg,image/png"`
    // one line above `accept={LOCAL}` walked straight past it. A single
    // `image/webp` is not drift, it is the output type Sharp and the canvas
    // both name, so matching one type alone would fire on honest code. The
    // second rule is deliberately loose about what sits between `accept` and
    // the literal, so a ternary picking one type per branch is caught too.
    const SPELLS_OUT_A_LIST = /image\/[a-z+]+["'`]?\s*,\s*["'`]?image\//;
    const NARROWS_A_PICKER = /accept[^"'`]*["'`][^"'`]*image\//;
    const offenders: string[] = [];
    for (const path of walk("src")) {
      if (path.includes("__tests__") || path.includes(".test.")) {
        continue;
      }
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          const trimmed = line.trim();
          // A comment explaining the rule must be able to quote it.
          if (
            trimmed.startsWith("*") ||
            trimmed.startsWith("//") ||
            trimmed.startsWith("/*")
          ) {
            return;
          }
          if (SPELLS_OUT_A_LIST.test(line) || NARROWS_A_PICKER.test(line)) {
            offenders.push(`${path}:${i + 1}`);
          }
        });
    }
    expect(
      offenders,
      `Spell the allowlist once: import ALLOWED_IMAGE_TYPES or IMAGE_FILE_ACCEPT from #/lib/image-upload-policy instead. Offenders: ${offenders.join(", ")}`
    ).toEqual([]);
  });
});
