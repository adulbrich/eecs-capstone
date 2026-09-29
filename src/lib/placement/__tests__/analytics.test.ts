import { describe, expect, it } from "vitest";
import {
  bidsPerProject,
  ordinal,
  percentDown,
  priorityDistribution,
  teamSizes,
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
  pinned = false,
  rosterOnly = false,
  preApproved = false
): BoardRow => ({
  email,
  name: email,
  avoid: undefined,
  comment: "",
  groupKey: "",
  groupLabel: "",
  pinned,
  preApproved,
  priority,
  projectKey,
  rosterOnly,
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

describe("priorityDistribution with roster students (#666)", () => {
  it("counts roster students placed without bids apart from the rest", () => {
    const rows = [
      row("a", "p1", 1),
      row("k", "p2", null, false, true),
      row("l", "p2", null, true, true),
      row("e", "p3", null),
    ];
    expect(priorityDistribution(rows).map((r) => [r.label, r.count])).toEqual([
      ["1st choice", 1],
      ["Pinned outside their bids", 1],
      ["Placed without bids (not in the survey)", 1],
      ["Placed outside their bids", 1],
    ]);
  });
});

describe("priorityDistribution with pre-approvals (#670)", () => {
  it("counts a pre-approved student once, apart from their bids", () => {
    const rows = [
      row("a", "p1", 1),
      row("b", "p2", 1, true, false, true),
      row("k", "p3", null, true, true, true),
    ];
    expect(priorityDistribution(rows).map((r) => [r.label, r.count])).toEqual([
      ["1st choice", 1],
      ["Pre-approved", 2],
    ]);
  });
});

describe("teamSizes (#701)", () => {
  const on = (email: string, projectKey: string, team: number): BoardRow => ({
    ...row(email, projectKey, 1),
    team,
  });

  it("counts each project's teams apart, with the mean and range of their sizes", () => {
    const rows = [
      on("a", "p1", 1),
      on("b", "p1", 1),
      on("c", "p1", 1),
      on("d", "p1", 2),
      on("e", "p1", 2),
      on("f", "p1", 2),
      on("g", "p1", 2),
      // Team 1 of another project is another team.
      on("h", "p2", 1),
      on("i", "p2", 1),
      on("j", "p2", 1),
      on("k", "p2", 1),
      row("z", null, null),
    ];
    expect(teamSizes(rows)).toEqual({
      bySize: [
        { size: 3, teams: 1, students: 3 },
        { size: 4, teams: 2, students: 8 },
      ],
      teams: 3,
      projects: 2,
      mean: 11 / 3,
      min: 3,
      max: 4,
    });
  });

  it("counts a one-student team a Move started", () => {
    const rows = [
      on("a", "p1", 1),
      on("b", "p1", 1),
      on("c", "p1", 1),
      on("m", "p2", 1),
    ];
    const sizes = teamSizes(rows);
    expect(sizes.teams).toBe(2);
    expect([sizes.min, sizes.max, sizes.mean]).toEqual([1, 3, 2]);
  });

  it("has no teams and no sizes with nobody placed", () => {
    const none = {
      bySize: [],
      teams: 0,
      projects: 0,
      mean: null,
      min: null,
      max: null,
    };
    expect(teamSizes([])).toEqual(none);
    expect(teamSizes([row("z", null, null)])).toEqual(none);
  });
});

describe("percentDown (#701)", () => {
  it.each([
    [29, 100, 29],
    [57, 100, 57],
    [199, 200, 99],
    [1, 201, 0],
    [3, 3, 100],
  ])("writes %i of %i as %i", (count, of, percent) => {
    expect(percentDown(count, of)).toBe(percent);
  });
});
