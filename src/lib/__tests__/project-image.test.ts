import { describe, expect, it } from "vitest";
import { PROJECT_PLACEHOLDER_IMAGE, projectImageSrc } from "../project-image";
import { STORAGE_PUBLIC_BASE } from "../storage";

describe("projectImageSrc", () => {
  it("falls back to the placeholder when the project has no image", () => {
    expect(projectImageSrc(null)).toBe(PROJECT_PLACEHOLDER_IMAGE);
    expect(projectImageSrc(undefined)).toBe(PROJECT_PLACEHOLDER_IMAGE);
    expect(projectImageSrc("")).toBe(PROJECT_PLACEHOLDER_IMAGE);
  });

  it("resolves a storage key against the public base", () => {
    expect(projectImageSrc("projects/abc/img.webp")).toBe(
      `${STORAGE_PUBLIC_BASE}/projects/abc/img.webp`
    );
  });

  it("passes absolute URLs through unchanged", () => {
    expect(projectImageSrc("https://example.com/x.png")).toBe(
      "https://example.com/x.png"
    );
  });

  it("serves the placeholder from public/, not from object storage", () => {
    // Regression guard: routing the placeholder through getPublicUrl would
    // prefix the storage base (or the production CDN) and 404.
    expect(PROJECT_PLACEHOLDER_IMAGE.startsWith("/")).toBe(true);
    expect(PROJECT_PLACEHOLDER_IMAGE).not.toContain(STORAGE_PUBLIC_BASE);
  });
});
