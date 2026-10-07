import { describe, expect, it } from "vitest";
import {
  PROJECT_URL_MAX,
  PROJECT_URL_MESSAGES,
  projectUrlHref,
  projectUrlSchema,
} from "#/lib/project-url";

function messages(value: string): string[] {
  const r = projectUrlSchema.safeParse(value);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

describe("projectUrlSchema", () => {
  it.each([
    "",
    "https://example.com",
    "http://example.com/path",
    "https://example.com/?ids=1,2",
    "https://web.archive.org/web/2020/https://example.com",
    "HTTPS://EXAMPLE.COM",
  ])("accepts %j", (value) => {
    expect(messages(value)).toEqual([]);
  });

  it("trims the ends before checking, and returns the trimmed value", () => {
    expect(projectUrlSchema.parse("  https://example.com \n")).toBe(
      "https://example.com"
    );
  });

  // The value that prompted #776, which zod's `.url()` accepted.
  it.each([
    "https://www.youtube.com/watch?v=OTqDBUREVjY https://www.youtube.com/watch?v=dpEyBdczGe4",
    "https://a.com\nhttps://b.com",
    "https://a.com\thttps://b.com",
    "https://a.com,https://b.com",
    "https://a.com;http://b.com",
    "Company site: https://a.com",
  ])("rejects more than one link in %j", (value) => {
    expect(messages(value)).toEqual([PROJECT_URL_MESSAGES.oneLink]);
  });

  it.each([
    "www.example.com",
    "javascript:alert(1)",
    "ftp://example.com",
    "mailto:someone@example.com",
  ])("rejects %j for its scheme", (value) => {
    expect(messages(value)).toEqual([PROJECT_URL_MESSAGES.scheme]);
  });

  it("rejects a scheme with no host", () => {
    expect(messages("https://")).toEqual([PROJECT_URL_MESSAGES.invalid]);
  });

  it("rejects a link over the length cap", () => {
    const long = `https://example.com/${"a".repeat(PROJECT_URL_MAX)}`;
    expect(projectUrlSchema.safeParse(long).success).toBe(false);
  });
});

describe("projectUrlHref", () => {
  it("links a valid stored URL, trimmed", () => {
    expect(projectUrlHref(" https://example.com ")).toBe("https://example.com");
  });

  it.each([
    null,
    "",
    "none",
    "www.example.com",
    "javascript:alert(1)",
    "https://a.com https://b.com",
  ])("does not link %j", (stored) => {
    expect(projectUrlHref(stored)).toBeNull();
  });
});
