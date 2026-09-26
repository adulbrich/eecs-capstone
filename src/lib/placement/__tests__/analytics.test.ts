import { describe, expect, it } from "vitest";
import {
  bidsPerProject,
  ordinal,
  priorityDistribution,
} from "#/lib/placement/analytics";
import type { BoardRow } from "#/lib/placement/board";

// Invented data, with every expectation worked out by hand (#650).

const PROJECTS = [
  { key: "p1", title: "Tide Clock", weightMultiplier: 1 },
  { key: "p2", title: "Robot Arm", weightMultiplier: 1 },
  { key: "p3", title: "Garden Planner", weightMultiplier: 1 },
  { key: "p4", title: "Lantern Map", weightMultiplier: 1 },
];

const bid = (projectKey: string, priority: number) => ({
  projectKey,
  priority,
  comment: "",
});

const STUDENTS = [
  { email: "a@x.edu", name: "A", bids: [bid("p1", 1), bid("p2", 2)] },
  { email: "b@x.edu", name: "B", bids: [bid("p1", 1), bid("p3", 2)] },
  { email: "c@x.edu", name: "C", bids: [bid("p2", 1), bid("p1", 2)] },
];

describe("bidsPerProject", () => {
  it("lists every project, fewest bids first, zero-bid projects included", () => {
    expect(bidsPerProject(STUDENTS, PROJECTS)).toEqual([
      { key: "p4", title: "Lantern Map", firstChoice: 0, total: 0 },
      { key: "p3", title: "Garden Planner", firstChoice: 0, total: 1 },
      { key: "p2", title: "Robot Arm", firstChoice: 1, total: 2 },
      { key: "p1", title: "Tide Clock", firstChoice: 2, total: 3 },
    ]);
  });

  it("ignores a bid on a project that is not in the list", () => {
    const stray = [{ email: "d@x.edu", name: "D", bids: [bid("gone", 1)] }];
    expect(bidsPerProject(stray, PROJECTS).every((p) => p.total === 0)).toBe(
      true
    );
  });
});

const row = (
  email: string,
  projectKey: string | null,
  priority: number | null,
  pinned = false
): BoardRow => ({
  email,
  name: email,
  avoid: undefined,
  comment: "",
  groupKey: "",
  groupLabel: "",
  pinned,
  priority,
  projectKey,
  team: projectKey === null ? null : 1,
  unplacedReason: projectKey === null ? "no_eligible_project" : null,
});

describe("priorityDistribution", () => {
  it("counts each priority with zeros between, then placements outside the bids", () => {
    const rows = [
      row("a", "p1", 1),
      row("b", "p1", 1),
      row("c", "p2", 3),
      row("d", "p2", null, true),
      row("e", "p3", null),
      row("f", null, null),
    ];
    expect(priorityDistribution(rows)).toEqual([
      { label: "1st choice", count: 2, ofPlaced: 2 / 5, ofAll: 2 / 6 },
      { label: "2nd choice", count: 0, ofPlaced: 0, ofAll: 0 },
      { label: "3rd choice", count: 1, ofPlaced: 1 / 5, ofAll: 1 / 6 },
      {
        label: "Pinned outside their bids",
        count: 1,
        ofPlaced: 1 / 5,
        ofAll: 1 / 6,
      },
      {
        label: "Placed outside their bids",
        count: 1,
        ofPlaced: 1 / 5,
        ofAll: 1 / 6,
      },
    ]);
  });

  it("is empty with nobody placed, and never divides by zero", () => {
    expect(priorityDistribution([])).toEqual([]);
    expect(priorityDistribution([row("f", null, null)])).toEqual([]);
  });
});

describe("ordinal", () => {
  it.each([
    [1, "1st"],
    [2, "2nd"],
    [3, "3rd"],
    [4, "4th"],
    [11, "11th"],
    [12, "12th"],
    [13, "13th"],
    [21, "21st"],
    [22, "22nd"],
  ])("writes %i as %s", (n, text) => {
    expect(ordinal(n)).toBe(text);
  });
});
