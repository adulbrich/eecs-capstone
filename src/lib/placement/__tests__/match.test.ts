import { describe, expect, it } from "vitest";
import {
  rankProjects,
  SUGGESTION_THRESHOLD,
  suggestProject,
  titleSimilarity,
} from "#/lib/placement/match";

// Invented titles only (#648).

const PROJECTS = [
  { key: "p1", title: "Robot Arm Controller" },
  { key: "p2", title: "Tide Clock for the Marine Science Center" },
  { key: "p3", title: "Garden Planner" },
];

describe("titleSimilarity", () => {
  it("is 1 for titles that differ only in case, spacing and trailing punctuation", () => {
    expect(
      titleSimilarity("robot  ARM controller:", "Robot Arm Controller")
    ).toBe(1);
  });

  it("is 0 when either title is empty or a single character", () => {
    expect(titleSimilarity("", "Robot Arm")).toBe(0);
    expect(titleSimilarity("  ", "")).toBe(0);
    expect(titleSimilarity("R", "Robot Arm")).toBe(0);
  });

  it("counts an emoji as one character, not two", () => {
    const robot = "\u{1F916}";
    expect(titleSimilarity(`${robot} Arm`, `${robot} Arm`)).toBe(1);
    // Four pairs each, three shared. Split into UTF-16 halves it would be
    // five pairs each, four shared, and 0.8.
    expect(titleSimilarity(`${robot} Arm`, `${robot} Ark`)).toBeCloseTo(0.75);
  });

  it("scores a typo high and an unrelated title low", () => {
    expect(
      titleSimilarity("Robot Arm Contoller", "Robot Arm Controller")
    ).toBeGreaterThan(0.9);
    expect(
      titleSimilarity("Robot Arm Contoller", "Garden Planner")
    ).toBeLessThan(0.2);
  });

  it("raises a title cut short to the start of the project's title", () => {
    const cut = "Tide Clock for the Marine Sci...";
    expect(titleSimilarity(cut, PROJECTS[1].title)).toBeGreaterThanOrEqual(
      SUGGESTION_THRESHOLD
    );
  });

  it("does not raise a short prefix", () => {
    expect(titleSimilarity("Tide", PROJECTS[1].title)).toBeLessThan(
      SUGGESTION_THRESHOLD
    );
  });
});

describe("rankProjects and suggestProject", () => {
  it("ranks every project, most similar first, and suggests the best", () => {
    const ranked = rankProjects("Robot Arm Contoller", PROJECTS);
    expect(ranked).toHaveLength(3);
    expect(ranked[0].key).toBe("p1");
    expect(ranked[0].score).toBeGreaterThanOrEqual(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThanOrEqual(ranked[2].score);
    expect(suggestProject(ranked)?.key).toBe("p1");
  });

  it("suggests nothing when the best is below the threshold", () => {
    expect(suggestProject(rankProjects("Campus Parking App", PROJECTS))).toBe(
      undefined
    );
  });

  it("suggests nothing when there are no projects", () => {
    expect(suggestProject(rankProjects("Robot Arm", []))).toBe(undefined);
  });

  it("breaks a tie by title", () => {
    const ranked = rankProjects("zzz", [
      { key: "b", title: "Beta" },
      { key: "a", title: "Alpha" },
    ]);
    expect(ranked.map((c) => c.key)).toEqual(["a", "b"]);
  });
});
