import { describe, expect, it } from "vitest";
import {
  ALLOWED_IMAGE_TYPES,
  assertImageFile,
  IMAGE_FILE_ACCEPT,
  MAX_IMAGE_BYTES,
} from "../image-upload-policy";

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
  // The file picker offers exactly what the server will take. These drifted
  // apart as three copies before this module existed, so the agreement is
  // asserted rather than assumed.
  it("names the same types as the allowlist", () => {
    expect(IMAGE_FILE_ACCEPT.split(",")).toEqual([...ALLOWED_IMAGE_TYPES]);
  });
});
