import { describe, expect, it } from "vitest";
import { getPublicUrl } from "../storage";

// Note: VITE_STORAGE_PUBLIC_BASE is captured at module load. We assert the
// fallback path here. End-to-end URL wiring is covered by integration tests
// where the real env is loaded.

describe("getPublicUrl", () => {
  it("returns null for null/undefined/empty", () => {
    expect(getPublicUrl(null)).toBeNull();
    expect(getPublicUrl(undefined)).toBeNull();
    expect(getPublicUrl("")).toBeNull();
  });

  it("returns the value unchanged for http/https URLs", () => {
    expect(getPublicUrl("https://example.com/x.png")).toBe(
      "https://example.com/x.png",
    );
    expect(getPublicUrl("http://example.com/x.png")).toBe(
      "http://example.com/x.png",
    );
  });

  it("prefixes the public base and strips leading slashes", () => {
    // In the test runner, VITE_STORAGE_PUBLIC_BASE is unset, so PUBLIC_BASE
    // falls back to `/storage`. We assert against that exact value, not a
    // suffix-only regex, so a future change to either the fallback or the
    // join logic is caught.
    expect(getPublicUrl("projects/abc/img.webp")).toBe(
      "/storage/projects/abc/img.webp",
    );
    expect(getPublicUrl("/projects/abc/img.webp")).toBe(
      "/storage/projects/abc/img.webp",
    );
    expect(getPublicUrl("///projects/abc/img.webp")).toBe(
      "/storage/projects/abc/img.webp",
    );
  });
});
