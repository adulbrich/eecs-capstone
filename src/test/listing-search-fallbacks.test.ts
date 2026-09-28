import { defaultParseSearch } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { searchSchema as inventorySearch } from "#/routes/_public/inventory/index";
import { searchSchema as projectsSearch } from "#/routes/_public/projects/index";

/**
 * A malformed param on a public listing renders the listing as if the param
 * were absent, rather than failing `validateSearch` into a 500 (#609). Each
 * URL goes through the router's own parser first, because that is what turns
 * `page=abc` into a string and `q=2024` into a number before the schema sees
 * either.
 */
function parse(
  schema: typeof projectsSearch | typeof inventorySearch,
  url: string
) {
  return schema.parse(defaultParseSearch(url));
}

describe.each([
  ["/projects", projectsSearch],
  ["/inventory", inventorySearch],
] as const)("%s search params", (_path, schema) => {
  const defaults = schema.parse({});

  it.each([
    "?program=x",
    "?page=abc",
    "?page=0",
    "?page=-3",
    "?page=1.5",
    "?archivedOnly=maybe",
    "?acceptingOnly=1",
    "?status=lost",
    "?order=alphabetical",
    "?view=row",
    "?cols=123",
    "?categories=abc",
    "?q=%7B%22a%22%3A1%7D",
  ])("reads %s as the default", (url) => {
    expect(parse(schema, url)).toEqual(defaults);
  });

  it("keeps a numeric or boolean search as the text the reader typed", () => {
    expect(parse(schema, "?q=2024").q).toBe("2024");
    expect(parse(schema, "?q=true").q).toBe("true");
    expect(parse(schema, "?q=rover").q).toBe("rover");
  });

  it("still keeps a well-formed page", () => {
    expect(parse(schema, "?page=3").page).toBe(3);
  });
});

describe("/projects filters", () => {
  it("still keeps a well-formed program and switch", () => {
    const program = "11111111-1111-4111-8111-111111111111";
    const parsed = parse(
      projectsSearch,
      `?program=${program}&archivedOnly=true&acceptingOnly=false`
    );
    expect(parsed).toMatchObject({
      program,
      archivedOnly: true,
      acceptingOnly: false,
    });
  });
});
