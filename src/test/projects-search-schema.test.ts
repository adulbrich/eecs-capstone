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

/**
 * `order` carries no default, unlike every other filter param, because the
 * router writes a schema default into the URL and that would make "chose
 * relevance" and "has not chosen yet" the same URL. The server needs to tell
 * them apart to resolve an absent one from the viewer's interest vector
 * (#424).
 */
describe("/projects order search param", () => {
  it("is undefined when absent, rather than defaulted", () => {
    expect(searchSchema.parse({}).order).toBeUndefined();
  });

  it("keeps an explicit choice", () => {
    expect(searchSchema.parse({ order: "relevance" }).order).toBe("relevance");
    expect(searchSchema.parse({ order: "recommended" }).order).toBe(
      "recommended"
    );
  });

  /**
   * Unlike `categories` and `view`, a bad `order` is a router error rather
   * than a silent fallback. Pinned so the choice is deliberate: the value is
   * typed into a URL by hand or not at all, and the three filters that use
   * `.catch` do so because a stale link from a real feature could carry them.
   */
  it("refuses a value the enum does not know", () => {
    expect(() => searchSchema.parse({ order: "oldest" })).toThrow();
  });
});
