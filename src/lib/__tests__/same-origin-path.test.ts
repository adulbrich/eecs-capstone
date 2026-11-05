import { fc, test } from "@fast-check/vitest";
import { describe, expect, it } from "vitest";
import { sameOriginPath } from "../same-origin-path";

/**
 * What a redirect smuggles another host past a prefix check with: characters
 * the URL parser drops (tab, newline, CR), ones it turns into a slash
 * (backslash, and the fullwidth slash some decoders fold), percent-encoded
 * slashes and dots, userinfo, and dot segments that collapse into `//`.
 */
const PATH_PIECES = [
  "/",
  "//",
  "/.",
  "/..",
  ".",
  "..",
  "\\",
  "\t",
  "\n",
  "\r",
  "%2f",
  "%2F",
  "%5c",
  "%5C",
  "%2e",
  "%2E",
  "@",
  "／",
  ":",
  "?",
  "#",
  "a",
  "evil.example",
];

const pathPieces = fc.string({ unit: fc.constantFrom(...PATH_PIECES) });

/** Most values start with a slash, since anything else is refused at once. */
const redirectValue = fc.oneof(
  pathPieces,
  pathPieces.map((rest) => `/${rest}`)
);

/** Not the helper's own placeholder, and nested, so a relative path shows. */
const ELSEWHERE = "https://capstone.example.edu/projects/abc";

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
    // Each passes the prefix checks and resolves to `//evil.example`, so the
    // resolved path has to be checked as well as the input.
    ["a dot segment before the slashes", "/.//evil.example"],
    ["a parent segment before the slashes", "/a/..//evil.example"],
    ["an encoded dot segment", "/%2e//evil.example"],
    ["a dot segment before a backslash", "/./\\evil.example"],
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

  // More runs than the default, because this is the one security property
  // here. The known bypasses are the examples above, and removing the second
  // check fails within ten runs; what the property is for is the bypass nobody
  // has listed yet, an ordering of four or five pieces that a hundred runs
  // sample thinly. 20,000 is what the spike in #485 ran.
  test.prop([redirectValue], { numRuns: 20_000 })(
    "returns nothing, or a path with one leading slash that stays on the origin it is resolved against, and keeps what it returns",
    (value) => {
      const path = sameOriginPath(value);
      if (path !== undefined) {
        expect(path).toMatch(/^\/(?![/\\])/u);
        expect(new URL(path, ELSEWHERE).origin).toBe(new URL(ELSEWHERE).origin);
        expect(sameOriginPath(path)).toBe(path);
      }
    }
  );
});
