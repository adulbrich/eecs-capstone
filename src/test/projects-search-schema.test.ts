import { describe, expect, it } from "vitest";
import { searchSchema } from "#/routes/projects/index";

const UUID = "11111111-1111-4111-8111-111111111111";

// A stale or hand-edited /projects link with a bad `categories` value must
// load the page unfiltered, the way /inventory does, rather than fail
// validateSearch and land in the error boundary. docs/QUIRKS.md
// ("Categories: `domain` is closed ...") makes `.catch([])` the rule for
// every category filter; this pins /projects to it.
describe("/projects categories search param", () => {
  it("keeps a well-formed list", () => {
    expect(searchSchema.parse({ categories: [UUID] }).categories).toEqual([
      UUID,
    ]);
  });

  it("drops a list with a non-UUID entry", () => {
    expect(
      searchSchema.parse({ categories: ["not-a-uuid"] }).categories
    ).toEqual([]);
  });

  it("drops a scalar", () => {
    expect(searchSchema.parse({ categories: "abc" }).categories).toEqual([]);
  });

  it("drops a list longer than the server cap of 20", () => {
    const many = Array.from({ length: 21 }, () => UUID);
    expect(searchSchema.parse({ categories: many }).categories).toEqual([]);
  });
});
