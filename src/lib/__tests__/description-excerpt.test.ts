import { describe, expect, it } from "vitest";
import {
  descriptionExcerpt,
  LISTING_EXCERPT_LENGTH,
  SIMILAR_PROJECT_EXCERPT_LENGTH,
} from "#/lib/description-excerpt";

/**
 * Plain words up to just short of `budget` in the raw string, then a link and
 * a bold run that both straddle it, then more words. Cutting the raw string
 * at `budget` would land inside the link's URL.
 */
function straddling(budget: number): string {
  const lead = "word ".repeat(Math.floor((budget - 10) / 5));
  return `${lead}[a linked phrase that runs on](https://example.com/a/long/path) and **bold text across the budget** ${"tail ".repeat(40)}`;
}

const BUDGETS = [LISTING_EXCERPT_LENGTH, SIMILAR_PROJECT_EXCERPT_LENGTH];

describe.each(BUDGETS)("descriptionExcerpt at %i", (max) => {
  it("is null for no description", () => {
    expect(descriptionExcerpt(null, max)).toBeNull();
    expect(descriptionExcerpt(undefined, max)).toBeNull();
    expect(descriptionExcerpt("", max)).toBeNull();
  });

  it("is null for markdown that strips to nothing", () => {
    const image = "![diagram](https://x.test/a.png)";
    expect(descriptionExcerpt(image, max)).toBeNull();
    expect(descriptionExcerpt("```\nconst a = 1;\n```", max)).toBeNull();
  });

  it("returns stripped text that fits uncut", () => {
    const plain = "a".repeat(max);
    expect(descriptionExcerpt(`**${plain}**`, max)).toBe(plain);
  });

  it("cuts longer text to the budget, ellipsis included", () => {
    const excerpt = descriptionExcerpt("lorem ipsum ".repeat(100), max);
    expect(excerpt).not.toBeNull();
    expect(excerpt?.length).toBeLessThanOrEqual(max);
    expect(excerpt?.endsWith("...")).toBe(true);
    expect(excerpt).toMatch(/ipsum\.\.\.$|lorem\.\.\.$/);
  });

  it("leaves no markdown behind when a link or emphasis straddles the budget", () => {
    const excerpt = descriptionExcerpt(straddling(max), max) ?? "";
    expect(excerpt.length).toBeLessThanOrEqual(max);
    expect(excerpt.endsWith("...")).toBe(true);
    expect(excerpt).not.toContain("[");
    expect(excerpt).not.toContain("](");
    expect(excerpt).not.toContain("*");
  });
});
