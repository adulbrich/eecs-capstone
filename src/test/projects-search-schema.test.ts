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

describe("/projects switch params", () => {
  it("defaults the openings switch on and the rest off", () => {
    // `acceptingOnly` is the one default that is not false (#419): a student
    // opening the listing wants projects they can join, so a shared link
    // carrying no param hides the full teams.
    expect(searchSchema.parse({})).toMatchObject({
      acceptingOnly: true,
      requiresNdaOnly: false,
      studentProposedOnly: false,
    });
    expect(searchSchema.parse({ acceptingOnly: false }).acceptingOnly).toBe(
      false
    );
    expect(searchSchema.parse({ requiresNdaOnly: true }).requiresNdaOnly).toBe(
      true
    );
  });

  it("drops the two mentor switches #402 removed rather than honoring them", () => {
    // A pasted link from before #402 loads the page unfiltered on them.
    const parsed = searchSchema.parse({
      seekingMentorOnly: true,
      noMentorNeededOnly: true,
    });
    expect("seekingMentorOnly" in parsed).toBe(false);
    expect("noMentorNeededOnly" in parsed).toBe(false);
  });
});
