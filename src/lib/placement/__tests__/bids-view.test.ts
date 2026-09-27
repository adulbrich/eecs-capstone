import { describe, expect, it } from "vitest";
import { projectBidRows } from "#/lib/placement/bids-view";
import type { PlacementStudent } from "#/lib/placement/types";

// Invented names and titles only (#648).

const PROJECTS = [
  { key: "p1", title: "Tide Clock", weightMultiplier: 1 },
  { key: "p2", title: "Robot Arm", weightMultiplier: 1 },
  { key: "p3", title: "Garden Planner", weightMultiplier: 1 },
];

const bid = (projectKey: string, priority: number, comment = "") => ({
  projectKey,
  priority,
  comment,
});

describe("projectBidRows", () => {
  it("groups bids by project title, first choices first, and keeps a project with none", () => {
    const students: PlacementStudent[] = [
      {
        email: "ada@example.edu",
        name: "Ada Park",
        bids: [bid("p1", 2, "Tides"), bid("p2", 1)],
      },
      {
        email: "ben@example.edu",
        name: "Ben Ito",
        bids: [bid("p1", 1, "Clocks")],
      },
    ];
    const rows = projectBidRows(students, PROJECTS);
    expect(rows.map((r) => [r.projectTitle, r.email, r.priority])).toEqual([
      ["Garden Planner", "", null],
      ["Robot Arm", "ada@example.edu", 1],
      ["Tide Clock", "ben@example.edu", 1],
      ["Tide Clock", "ada@example.edu", 2],
    ]);
    expect(rows[0].empty).toBe(true);
    expect(rows[3].comment).toBe("Tides");
  });

  it("marks a pin here, a pin elsewhere, a pre-approval, and a pin without a bid", () => {
    const students: PlacementStudent[] = [
      {
        email: "ada@example.edu",
        name: "Ada Park",
        bids: [bid("p1", 1), bid("p2", 2)],
        pin: "p2",
      },
      {
        email: "kim@example.edu",
        name: "Kim Lee",
        bids: [],
        rosterOnly: true,
        pin: "p3",
        preApproved: true,
      },
    ];
    const rows = projectBidRows(students, PROJECTS);
    const find = (key: string, email: string) =>
      rows.find((r) => r.projectKey === key && r.email === email);
    expect(find("p1", "ada@example.edu")).toMatchObject({
      pinnedHere: false,
      pinnedElsewhere: "Robot Arm",
    });
    expect(find("p2", "ada@example.edu")).toMatchObject({
      pinnedHere: true,
      pinnedElsewhere: null,
      preApproved: false,
    });
    expect(find("p3", "kim@example.edu")).toMatchObject({
      pinnedHere: true,
      preApproved: true,
      priority: null,
    });
  });

  it("ignores a bid on a project that is not in the list", () => {
    const rows = projectBidRows(
      [{ email: "ada@example.edu", name: "Ada", bids: [bid("gone", 1)] }],
      PROJECTS
    );
    expect(rows.every((r) => r.empty)).toBe(true);
  });
});

describe("projectBidRows and roster projects (#670)", () => {
  it("marks a project added from the roster as fixed", () => {
    const rows = projectBidRows(
      [
        {
          email: "kim@example.edu",
          name: "Kim Lee",
          bids: [],
          pin: "roster:lab",
          preApproved: true,
        },
      ],
      [
        ...PROJECTS,
        {
          key: "roster:lab",
          title: "Sponsor Lab",
          maxTeams: 1,
          weightMultiplier: 1,
          fromRoster: true,
        },
      ]
    );
    expect(rows.find((r) => r.projectKey === "roster:lab")?.fixed).toBe(true);
    expect(rows.find((r) => r.projectKey === "p1")?.fixed).toBe(false);
  });
});
