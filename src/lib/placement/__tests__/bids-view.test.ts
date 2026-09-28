import { describe, expect, it } from "vitest";
import {
  pinnedRows,
  pinSource,
  placedSummary,
  projectBidRows,
  standingText,
  studentStanding,
} from "#/lib/placement/bids-view";
import type { PlacementStudent } from "#/lib/placement/types";
import type { StoredResult } from "#/lib/placement/workspace";

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

describe("pinnedRows and pinSource (#688)", () => {
  const students: PlacementStudent[] = [
    {
      email: "ada@example.edu",
      name: "Ada Park",
      bids: [bid("p1", 1), bid("p2", 2)],
      pin: "p2",
    },
    {
      email: "ben@example.edu",
      name: "Ben Ito",
      bids: [bid("p1", 1)],
      pin: "p3",
    },
    {
      email: "kim@example.edu",
      name: "Kim Lee",
      bids: [],
      pin: "p1",
      preApproved: true,
      rosterOnly: true,
    },
    { email: "cal@example.edu", name: "Cal Diaz", bids: [bid("p1", 2)] },
  ];
  const rows = projectBidRows(students, PROJECTS);

  it("keeps only the pinned rows, and one empty row for a project with none", () => {
    const narrowed = pinnedRows(rows);
    expect(
      narrowed.map((r) => [r.projectTitle, r.email, r.empty, pinSource(r)])
    ).toEqual([
      ["Garden Planner", "ben@example.edu", false, "not in their bids"],
      ["Robot Arm", "ada@example.edu", false, "2nd"],
      ["Tide Clock", "kim@example.edu", false, "pre-approved"],
    ]);
  });

  it("leaves an empty row for every project when nobody is pinned", () => {
    const unpinned = projectBidRows(
      students.map(({ pin: _pin, preApproved: _pre, ...s }) => s),
      PROJECTS
    );
    expect(pinnedRows(unpinned).map((r) => [r.projectTitle, r.empty])).toEqual([
      ["Garden Planner", true],
      ["Robot Arm", true],
      ["Tide Clock", true],
    ]);
    expect(pinnedRows([])).toEqual([]);
  });
});

describe("studentStanding and standingText (#689)", () => {
  const titles = new Map(PROJECTS.map((p) => [p.key, p.title]));
  const ada: PlacementStudent = {
    email: "ada@example.edu",
    name: "Ada Park",
    bids: [bid("p1", 1), bid("p2", 2)],
  };
  const result: StoredResult = {
    status: "optimal",
    objective: 1,
    gap: 0,
    placements: [
      { email: "ada@example.edu", projectKey: "p1", team: 2, priority: 1 },
      { email: "kim@example.edu", projectKey: "p3", team: 1, priority: null },
    ],
    unplaced: [{ email: "ben@example.edu", reason: "no_eligible_project" }],
    diagnostics: {
      seatShortfall: null,
      requiredSeatShortfall: null,
      pinnedProjectsBelowMin: [],
      pinOverflow: [],
      projectsBelowMin: [],
    },
    at: "2026-09-28T12:00:00.000Z",
    fingerprint: "x",
  };
  const text = (
    student: PlacementStudent,
    run: StoredResult | undefined,
    stale = false
  ) => standingText(studentStanding(student, run), titles, stale);

  it("shows only the pin for a pinned student, and whether the last run disagrees", () => {
    expect(text({ ...ada, pin: "p1" }, result)).toBe("Pinned to Tide Clock");
    expect(text({ ...ada, pin: "p2" }, result, true)).toBe(
      "Pinned to Robot Arm, applies from the next run"
    );
    expect(text({ ...ada, pin: "p2" }, undefined)).toBe("Pinned to Robot Arm");
  });

  it("shows the last placement, unplaced, not in the run, or no run", () => {
    expect(text(ada, result)).toBe("Placed: Tide Clock, team 2 (1st)");
    expect(text(ada, result, true)).toBe(
      "Placed: Tide Clock, team 2 (1st) (before your changes)"
    );
    expect(
      text(
        {
          email: "kim@example.edu",
          name: "Kim Lee",
          bids: [],
          rosterOnly: true,
        },
        result
      )
    ).toBe("Placed: Garden Planner, team 1 (not in the survey)");
    expect(text({ ...ada, email: "ben@example.edu" }, result)).toBe(
      "Unplaced in the last run"
    );
    expect(text({ ...ada, email: "new@example.edu" }, result, true)).toBe(
      "Not in the last run"
    );
    expect(text(ada, undefined)).toBe("No run yet");
  });
});

describe("projectBidRows with a run, and placedSummary (#693)", () => {
  const students: PlacementStudent[] = [
    {
      email: "ada@example.edu",
      name: "Ada Park",
      bids: [bid("p1", 1), bid("p2", 2)],
    },
    { email: "ben@example.edu", name: "Ben Ito", bids: [bid("p1", 2)] },
    {
      email: "kim@example.edu",
      name: "Kim Lee",
      bids: [],
      rosterOnly: true,
    },
    // Pinned to Garden Planner and placed there: one row, not two.
    {
      email: "cal@example.edu",
      name: "Cal Diaz",
      bids: [bid("p1", 1)],
      pin: "p3",
    },
  ];
  const result = {
    placements: [
      { email: "ada@example.edu", projectKey: "p1", team: 2, priority: 1 },
      { email: "ben@example.edu", projectKey: "p3", team: 1, priority: null },
      { email: "kim@example.edu", projectKey: "p3", team: 1, priority: null },
      { email: "cal@example.edu", projectKey: "p3", team: 1, priority: null },
    ],
  } as unknown as StoredResult;
  const rows = projectBidRows(students, PROJECTS, result);
  const of = (title: string) => rows.filter((r) => r.projectTitle === title);

  it("marks the team a student was placed on, and adds a row for a placement outside their bids", () => {
    expect(of("Tide Clock").map((r) => [r.email, r.placedTeam])).toEqual([
      ["ada@example.edu", 2],
      ["cal@example.edu", null],
      ["ben@example.edu", null],
    ]);
    expect(
      of("Garden Planner").map((r) => [
        r.email,
        r.priority,
        r.placedTeam,
        r.pinnedHere,
        r.rosterOnly,
      ])
    ).toEqual([
      ["ben@example.edu", null, 1, false, false],
      ["cal@example.edu", null, 1, true, false],
      ["kim@example.edu", null, 1, false, true],
    ]);
    expect(of("Robot Arm").map((r) => r.placedTeam)).toEqual([null]);
  });

  it("marks nothing without a run", () => {
    expect(
      projectBidRows(students, PROJECTS).some((r) => r.placedTeam !== null)
    ).toBe(false);
  });

  it("counts the placed students and first choices, with the stale note", () => {
    expect(placedSummary(of("Tide Clock"), true, false)).toBe(
      "Placed: 1 student, 1 on their first choice"
    );
    expect(placedSummary(of("Garden Planner"), true, true)).toBe(
      "Placed: 3 students, 0 on their first choice (before your changes)"
    );
    expect(placedSummary(of("Robot Arm"), true, false)).toBe(
      "No team in the last run"
    );
    expect(placedSummary(of("Tide Clock"), false, false)).toBeNull();
    expect(placedSummary([], true, false)).toBe("No team in the last run");
  });
});
