import { describe, expect, it } from "vitest";
import { getPublicUrl, STORAGE_PUBLIC_BASE } from "../storage";

// PUBLIC_BASE is captured at module load. To stay agnostic of whether
// VITE_STORAGE_PUBLIC_BASE is set in the test environment, assert against
// the live STORAGE_PUBLIC_BASE export.

describe("getPublicUrl", () => {
  it("returns null for null/undefined/empty", () => {
    expect(getPublicUrl(null)).toBeNull();
    expect(getPublicUrl(undefined)).toBeNull();
    expect(getPublicUrl("")).toBeNull();
  });

  it("returns the value unchanged for http/https URLs", () => {
    expect(getPublicUrl("https://example.com/x.png")).toBe(
      "https://example.com/x.png"
    );
    expect(getPublicUrl("http://example.com/x.png")).toBe(
      "http://example.com/x.png"
    );
  });

  it("prefixes the public base and strips leading slashes", () => {
    const expected = `${STORAGE_PUBLIC_BASE}/projects/abc/img.webp`;
    expect(getPublicUrl("projects/abc/img.webp")).toBe(expected);
    expect(getPublicUrl("/projects/abc/img.webp")).toBe(expected);
    expect(getPublicUrl("///projects/abc/img.webp")).toBe(expected);
  });
});
