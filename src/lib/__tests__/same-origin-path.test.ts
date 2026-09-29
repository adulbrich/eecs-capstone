import { describe, expect, it } from "vitest";
import { sameOriginPath } from "../same-origin-path";

describe("sameOriginPath", () => {
  it.each([
    ["/", "/"],
    ["/projects", "/projects"],
    ["/projects?page=2", "/projects?page=2"],
    ["/projects/abc#comments", "/projects/abc#comments"],
  ])("keeps the path %s", (value, kept) => {
    expect(sameOriginPath(value)).toBe(kept);
  });

  it.each([
    ["an absolute URL", "https://evil.example"],
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash authority", "/\\evil.example"],
    ["a javascript: URL", "javascript:alert(1)"],
    // The URL parser drops a tab or newline before it reads the authority,
    // so this is `//evil.example` by the time a browser resolves it. The
    // prefix checks alone would pass it.
    ["a tab inside the slashes", "/\t/evil.example"],
    ["a newline inside the slashes", "/\n/evil.example"],
    ["a relative path", "projects"],
    ["an empty string", ""],
  ])("reads %s as absent", (_name, value) => {
    expect(sameOriginPath(value)).toBeUndefined();
  });

  it.each([
    ["a number", 123],
    ["null", null],
    ["undefined", undefined],
    ["an object", { to: "/projects" }],
  ])("reads %s as absent", (_name, value) => {
    expect(sameOriginPath(value)).toBeUndefined();
  });

  it("returns what the URL parser resolved, so the check and the use agree", () => {
    expect(sameOriginPath("/a/../projects")).toBe("/projects");
  });
});
