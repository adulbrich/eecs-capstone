import { describe, expect, it } from "vitest";
import { webLinkHref, webLinkProblem, webLinkSchema } from "#/lib/web-link";

const MESSAGES = {
  invalid: "invalid",
  scheme: "scheme",
  several: "several",
} as const;

describe("webLinkProblem", () => {
  it.each([
    "https://example.com",
    "http://example.com/path",
    "https://example.com/?ids=1,2",
    "https://web.archive.org/web/2020/https://example.com",
    "HTTPS://EXAMPLE.COM",
  ])("passes %j", (value) => {
    expect(webLinkProblem(value)).toBeNull();
  });

  it.each([
    "https://www.youtube.com/watch?v=OTqDBUREVjY https://www.youtube.com/watch?v=dpEyBdczGe4",
    "https://a.com\nhttps://b.com",
    "https://a.com\thttps://b.com",
    "https://a.com,https://b.com",
    "https://a.com;http://b.com",
    "https://a.com|https://b.com",
    "Company site: https://a.com",
  ])("finds more than one link in %j", (value) => {
    expect(webLinkProblem(value)).toBe("several");
  });

  it.each([
    "www.example.com",
    "javascript:alert(1)",
    "ftp://example.com",
    "mailto:someone@example.com",
  ])("finds the scheme wrong in %j", (value) => {
    expect(webLinkProblem(value)).toBe("scheme");
  });

  it("finds a scheme with no host invalid", () => {
    expect(webLinkProblem("https://")).toBe("invalid");
  });
});

describe("webLinkSchema", () => {
  const schema = webLinkSchema(40, MESSAGES);

  function messages(value: string): string[] {
    const result = schema.safeParse(value);
    return result.success
      ? []
      : result.error.issues.map((issue) => issue.message);
  }

  it("accepts the empty string, which is the form clearing the field", () => {
    expect(messages("")).toEqual([]);
  });

  it("trims the ends before checking, and returns the trimmed value", () => {
    expect(schema.parse("  https://example.com \n")).toBe(
      "https://example.com"
    );
  });

  it.each([
    ["https://a.com https://b.com", MESSAGES.several],
    ["javascript:alert(1)", MESSAGES.scheme],
    ["https://", MESSAGES.invalid],
  ])("fails %j with the field's own message", (value, message) => {
    expect(messages(value)).toEqual([message]);
  });

  it("rejects a link over the length cap", () => {
    expect(
      schema.safeParse(`https://example.com/${"a".repeat(40)}`).success
    ).toBe(false);
  });
});

describe("webLinkHref", () => {
  it("links a valid stored link, trimmed", () => {
    expect(webLinkHref(" https://example.com ")).toBe("https://example.com");
  });

  it.each([
    null,
    undefined,
    "",
    "none",
    "www.example.com",
    "javascript:alert(1)",
    "https://a.com https://b.com",
  ])("does not link %j", (stored) => {
    expect(webLinkHref(stored)).toBeNull();
  });
});
