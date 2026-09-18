import { describe, expect, it } from "vitest";
import {
  clampSearchQuery,
  SEARCH_QUERY_MAX,
  searchQuerySchema,
} from "#/lib/search-query";
import { searchInputSchema } from "#/server/search";

const LONG = "a".repeat(500);

describe("clampSearchQuery", () => {
  it("cuts a query past the cap and says it did", () => {
    const { query, truncated } = clampSearchQuery(LONG);
    expect(query).toHaveLength(SEARCH_QUERY_MAX);
    expect(truncated).toBe(true);
  });

  it("leaves a query at the cap alone", () => {
    const exact = "b".repeat(SEARCH_QUERY_MAX);
    expect(clampSearchQuery(exact)).toEqual({
      query: exact,
      truncated: false,
    });
  });

  it("trims before measuring, so padding is not length", () => {
    // 215 raw characters, 195 after trimming. The `.trim().max(200)` this
    // replaces accepted that string, and so must this: whitespace a reader
    // never sees must not read as a query that was too long (#478).
    const padded = `${" ".repeat(10)}${"c".repeat(195)}${" ".repeat(10)}`;
    expect(padded).toHaveLength(215);
    expect(clampSearchQuery(padded)).toEqual({
      query: "c".repeat(195),
      truncated: false,
    });
  });

  it("reads an empty box as an empty query", () => {
    expect(clampSearchQuery("   ")).toEqual({ query: "", truncated: false });
  });
});

describe("searchQuerySchema", () => {
  it("clamps instead of throwing", () => {
    expect(searchQuerySchema.parse(LONG)).toHaveLength(SEARCH_QUERY_MAX);
  });

  it("defaults a missing query to the empty string", () => {
    expect(searchQuerySchema.parse(undefined)).toBe("");
  });
});

describe("searchProjects over-length query", () => {
  // The public listing is the only one an anonymous visitor can reach, and
  // pasting 500 characters into its box used to throw `too_big` out of
  // `.parse` and land on the framework's default error page (#478).
  it("parses rather than rejecting, and searches the first 200 characters", () => {
    const parsed = searchInputSchema.parse({ query: LONG });
    expect(parsed.query).toBe("a".repeat(SEARCH_QUERY_MAX));
  });

  it("does not throw on a query far past the cap", () => {
    expect(() =>
      searchInputSchema.parse({ query: "d".repeat(10_000) })
    ).not.toThrow();
  });
});
