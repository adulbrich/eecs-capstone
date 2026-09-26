import { describe, expect, it } from "vitest";
import {
  applyPins,
  bidsWithPinsCsv,
  boardRows,
  describeRun,
  moveStudent,
  placementCsv,
  projectsWithoutTeam,
} from "#/lib/placement/board";
import { parseBidsCsv } from "#/lib/placement/csv";
import {
  EMPTY_WORKSPACE,
  inputFingerprint,
  parseWorkspace,
  type StoredResult,
  serializeWorkspace,
  type Workspace,
} from "#/lib/placement/workspace";

// Invented data only (#649).

const PROJECTS = [
  { key: "p1", title: "Tide Clock", weightMultiplier: 1 },
  { key: "p2", title: "Robot Arm", weightMultiplier: 1 },
  { key: "p3", title: "Garden Planner", weightMultiplier: 1 },
];
const TITLES = new Map(PROJECTS.map((p) => [p.key, p.title]));

const STUDENTS = [
  {
    email: "ada@example.edu",
    name: "Ada Park",
    avoid: "Sam from lab",
    bids: [
      { projectKey: "p1", priority: 1, comment: "- tides, mostly" },
      { projectKey: "p2", priority: 2, comment: "" },
    ],
  },
  {
    email: "ben@example.edu",
    name: "Ben Ito",
    pin: "p2",
    bids: [{ projectKey: "p1", priority: 1, comment: "Clocks." }],
  },
  { email: "cy@example.edu", name: "Cy Moss", bids: [] },
];

const RESULT: StoredResult = {
  at: "2026-09-25T18:00:00.000Z",
  fingerprint: "x",
  status: "optimal",
  placements: [
    { email: "ada@example.edu", projectKey: "p1", team: 1, priority: 1 },
    { email: "ben@example.edu", projectKey: "p2", team: 1, priority: null },
  ],
  unplaced: [{ email: "cy@example.edu", reason: "no_eligible_project" }],
  gap: null,
  objective: 100,
  diagnostics: {
    pinnedProjectsBelowMin: [],
    pinOverflow: [],
    projectsBelowMin: [],
    requiredSeatShortfall: null,
    seatShortfall: null,
  },
};

describe("applyPins", () => {
  it("pins, unpins, and leaves alone a student the board did not touch", () => {
    const pinned = applyPins(STUDENTS, {
      "ada@example.edu": "p2",
      "ben@example.edu": null,
    });
    expect(pinned.map((s) => s.pin)).toEqual(["p2", undefined, undefined]);
    expect(pinned[2]).toBe(STUDENTS[2]);
  });
});

describe("bidsWithPinsCsv", () => {
  it("re-imports to the same students and pins, a formula-like comment included", () => {
    const effective = applyPins(STUDENTS, { "cy@example.edu": "p3" });
    const csv = bidsWithPinsCsv(effective, TITLES);
    const { students, issues } = parseBidsCsv(csv, PROJECTS);
    expect(issues).toEqual([]);
    // Cy bid on nothing, so only the pin row brings them back.
    expect(students).toEqual(effective);
  });
});

describe("boardRows", () => {
  it("puts the unplaced first, then projects by title and teams in order", () => {
    const rows = boardRows(
      {
        ...RESULT,
        placements: [
          ...RESULT.placements,
          { email: "x@example.edu", projectKey: "p1", team: 2, priority: 1 },
        ],
      },
      [...STUDENTS, { email: "x@example.edu", name: "Xi", bids: [] }],
      PROJECTS
    );
    expect(rows.map((r) => [r.groupLabel, r.email])).toEqual([
      ["Unplaced", "cy@example.edu"],
      ["Robot Arm, team 1", "ben@example.edu"],
      ["Tide Clock, team 1", "ada@example.edu"],
      ["Tide Clock, team 2", "x@example.edu"],
    ]);
  });

  it("carries the comment for the project the student is on, and the pin", () => {
    const rows = boardRows(RESULT, STUDENTS, PROJECTS);
    const ada = rows.find((r) => r.email === "ada@example.edu");
    const ben = rows.find((r) => r.email === "ben@example.edu");
    expect(ada).toMatchObject({
      comment: "- tides, mostly",
      priority: 1,
      pinned: false,
      avoid: "Sam from lab",
    });
    expect(ben).toMatchObject({ comment: "", priority: null, pinned: true });
  });

  it("shows a student the run never saw as unplaced", () => {
    const late = { email: "dee@example.edu", name: "Dee", bids: [] };
    const rows = boardRows(RESULT, [...STUDENTS, late], PROJECTS);
    expect(rows.find((r) => r.email === late.email)?.unplacedReason).toBe(
      "not_in_run"
    );
  });
});

describe("projectsWithoutTeam", () => {
  it("lists projects allowed a team that formed none, not dropped ones", () => {
    const projects = [
      ...PROJECTS,
      { key: "p4", title: "Lantern Map", maxTeams: 0, weightMultiplier: 1 },
    ];
    expect(projectsWithoutTeam(RESULT, projects, 1).map((p) => p.key)).toEqual([
      "p3",
    ]);
  });
});

describe("moveStudent", () => {
  it("joins the smallest team of the target project and marks the result edited", () => {
    const withTwoTeams: StoredResult = {
      ...RESULT,
      placements: [
        ...RESULT.placements,
        { email: "x@example.edu", projectKey: "p1", team: 2, priority: 1 },
        { email: "y@example.edu", projectKey: "p1", team: 1, priority: 1 },
      ],
    };
    const moved = moveStudent(withTwoTeams, "ben@example.edu", "p1", 1);
    expect(moved.edited).toBe(true);
    expect(moved.placements.find((p) => p.email === "ben@example.edu")).toEqual(
      {
        email: "ben@example.edu",
        projectKey: "p1",
        team: 2,
        priority: 1,
      }
    );
  });

  it("places an unplaced student on the first team of a project with none formed", () => {
    const moved = moveStudent(RESULT, "cy@example.edu", "p3", null);
    expect(moved.unplaced).toEqual([]);
    expect(moved.placements.at(-1)).toMatchObject({
      projectKey: "p3",
      team: 1,
    });
  });
});

describe("placementCsv", () => {
  it("writes every student, with a blank project for the unplaced", () => {
    const csv = placementCsv(boardRows(RESULT, STUDENTS, PROJECTS), TITLES);
    const lines = csv.split("\r\n");
    expect(lines[0]).toBe("email,name,project,team,priority,comment,avoid");
    expect(lines).toContain("cy@example.edu,Cy Moss,,,,,");
    // The comment starts like a formula, so it carries the guard (#656).
    expect(lines).toContain(
      `ada@example.edu,Ada Park,Tide Clock,1,1,"'- tides, mostly",Sam from lab`
    );
  });
});

describe("workspace with a result", () => {
  it("still reads a workspace saved before pins and results existed", () => {
    const old = { ...EMPTY_WORKSPACE, projects: PROJECTS };
    expect(parseWorkspace(JSON.stringify(old)).ok).toBe(true);
  });

  it("round-trips pins and a stored result", () => {
    const workspace: Workspace = {
      ...EMPTY_WORKSPACE,
      projects: PROJECTS,
      pins: { "ada@example.edu": "p2", "ben@example.edu": null },
      result: RESULT,
    };
    expect(parseWorkspace(serializeWorkspace(workspace))).toEqual({
      ok: true,
      workspace,
    });
  });

  it("fingerprints the inputs a run reads, and not the pins", () => {
    const base = {
      ...EMPTY_WORKSPACE,
      projects: PROJECTS,
      titleMatches: undefined,
    };
    const pinned = { ...base, pins: { a: "p1" } };
    expect(inputFingerprint(pinned)).toBe(inputFingerprint(base));
    expect(
      inputFingerprint({
        ...base,
        parameters: { ...base.parameters, minStudents: 2 },
      })
    ).not.toBe(inputFingerprint(base));
  });
});

describe("describeRun", () => {
  it("says what stopped a run and every diagnostic, the outcome first", () => {
    const lines = describeRun(
      {
        ...RESULT,
        status: "infeasible",
        placements: [],
        diagnostics: {
          pinnedProjectsBelowMin: ["p3"],
          pinOverflow: [{ projectKey: "p2", pinned: 5, seats: 4 }],
          projectsBelowMin: ["p3"],
          requiredSeatShortfall: { required: 9, students: 3 },
          seatShortfall: { students: 3, seats: 2 },
        },
      },
      TITLES
    );
    expect(lines).toEqual([
      "No placement satisfies every rule at once.",
      "3 students can be placed but the projects have 2 seats at most.",
      "At least one team per project needs 9 students, and there are 3. Turn that rule off, or drop some projects.",
      "Students are pinned to Garden Planner, which cannot reach the minimum team size.",
      "5 students are pinned to Robot Arm, which seats 4.",
      "Too few students may join Garden Planner to form a team.",
    ]);
  });

  it("says so when the gap of a time-limited run is unknown", () => {
    expect(
      describeRun({ ...RESULT, status: "time_limit", gap: null }, TITLES)[0]
    ).toContain("is unknown");
  });

  it("gives the gap when the time limit stopped a run with a placement", () => {
    expect(
      describeRun({ ...RESULT, status: "time_limit", gap: 0.0123 }, TITLES)[0]
    ).toContain("within 1.2%");
  });
});
