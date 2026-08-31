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

  it("is the only image allowlist a file picker reads", () => {
    const offenders: string[] = [];
    for (const path of walk("src")) {
      if (path.includes("__tests__") || path.includes(".test.")) {
        continue;
      }
      readFileSync(path, "utf8")
        .split("\n")
        .forEach((line, i) => {
          // The brace forms matter as much as the quoted one: `accept={"..."}`
          // is what JSX is most likely to be written as, and an earlier regex
          // that anchored to the quote let exactly that through.
          if (/accept\s*=\s*\{?\s*["'`][^"'`]*image\//.test(line)) {
            offenders.push(`${path}:${i + 1}`);
          }
        });
    }
    expect(
      offenders,
      `Spell the allowlist once: import IMAGE_FILE_ACCEPT from #/lib/image-upload-policy instead. Offenders: ${offenders.join(", ")}`
    ).toEqual([]);
  });
});
