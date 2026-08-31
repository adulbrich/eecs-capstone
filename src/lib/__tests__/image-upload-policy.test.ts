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
    // Per file, not per line. A hand-written allowlist names two or more
    // distinct types, but it need not put them on one line and need not use
    // commas: a `Set` literal copy-pasted from this module spreads over five
    // lines, and a re-implemented guard reads
    // `t !== "image/jpeg" && t !== "image/png"`. Both walked past the
    // line-and-comma rule this replaced. Counting distinct types per file
    // catches every arrangement of them at once.
    //
    // One type is not drift: `image/webp` alone is the output content type
    // Sharp and the canvas both name, which is why the threshold is two.
    const MIME = /image\/[a-z0-9.+-]+/g;
    // Only reachable when the count did not fire, so this is about a picker
    // narrowed to a SINGLE type in a file that names no other. Anything
    // naming two, a ternary with one type per branch included, is already an
    // offender by count.
    const NARROWS_A_PICKER = /accept[^"'`]*["'`][^"'`]*image\//;
    const offenders: string[] = [];
    for (const path of walk("src")) {
      if (
        path.includes("__tests__") ||
        path.includes(".test.") ||
        path.endsWith("image-upload-policy.ts")
      ) {
        continue;
      }
      // Comment lines are dropped before counting, because a comment
      // explaining this rule has to be able to quote it, and this file is
      // not the only place that will want to.
      const code = readFileSync(path, "utf8")
        .split("\n")
        .filter((line) => {
          const t = line.trim();
          return !(
            t.startsWith("*") ||
            t.startsWith("//") ||
            t.startsWith("/*")
          );
        });
      const types = new Set(code.join("\n").match(MIME) ?? []);
      if (types.size > 1) {
        offenders.push(`${path} names ${[...types].sort().join(" ")}`);
      } else if (code.some((line) => NARROWS_A_PICKER.test(line))) {
        offenders.push(`${path} narrows the picker by hand`);
      }
    }
    expect(
      offenders,
      `Spell the allowlist once: import ALLOWED_IMAGE_TYPES or IMAGE_FILE_ACCEPT from #/lib/image-upload-policy instead. Offenders: ${offenders.join("; ")}`
    ).toEqual([]);
  });
});
