import { describe, expect, it } from "vitest";
import {
  EMPTY_WORKSPACE,
  inputFingerprint,
  isEmptyWorkspace,
  isStale,
  parseWorkspace,
  projectsFromPortal,
  pruneTitleMatches,
  removeStudents,
  restoreStudent,
  type StoredResult,
  serializeWorkspace,
  setAsideRemoved,
  toPlacementInput,
  type Workspace,
} from "#/lib/placement/workspace";

// Invented data only (#648).

const WORKSPACE: Workspace = {
  ...EMPTY_WORKSPACE,
  projectSource: { kind: "csv", filename: "projects.csv" },
  projects: [
    { key: "robot arm", title: "Robot Arm", weightMultiplier: 1 },
    {
      key: "tide clock",
      title: "Tide Clock",
      maxTeams: 2,
      minStudents: 2,
      weightMultiplier: 0.5,
    },
  ],
  bids: {
    filename: "bids.csv",
    text: "email,priority,project\nada@example.edu,1,Robot Arm",
  },
  parameters: { ...EMPTY_WORKSPACE.parameters, maxTeams: 3 },
};

describe("parseWorkspace", () => {
  it("reads back exactly what it serialized", () => {
    const parsed = parseWorkspace(serializeWorkspace(WORKSPACE));
    expect(parsed).toEqual({ ok: true, workspace: WORKSPACE });
  });

  it("keeps a pasted project source", () => {
    const workspace: Workspace = {
      ...WORKSPACE,
      projectSource: { kind: "pasted" },
    };
    expect(parseWorkspace(serializeWorkspace(workspace))).toEqual({
      ok: true,
      workspace,
    });
  });

  it("keeps a converted file's origin and conversion issues", () => {
    const converted: Workspace = {
      ...WORKSPACE,
      bids: {
        filename: "survey (converted).csv",
        text: "email,priority,project",
        convertedFrom: "survey.csv",
        conversionIssues: [{ level: "warning", row: 4, message: "Preview." }],
      },
    };
    expect(parseWorkspace(serializeWorkspace(converted))).toEqual({
      ok: true,
      workspace: converted,
    });
  });

  it("refuses text that is not JSON", () => {
    expect(parseWorkspace("{nope")).toEqual({
      ok: false,
      message: "The file is not JSON.",
    });
  });

  it("refuses JSON that is not a workspace", () => {
    expect(parseWorkspace('{"version":2}').ok).toBe(false);
  });

  it("refuses parameters the page would not allow", () => {
    const bad = (parameters: Partial<Workspace["parameters"]>) =>
      parseWorkspace(
        JSON.stringify({
          ...WORKSPACE,
          parameters: { ...WORKSPACE.parameters, ...parameters },
        })
      ).ok;
    expect(bad({ minStudents: 5, maxStudents: 4 })).toBe(false);
    expect(bad({ timeLimitSeconds: 0 })).toBe(false);
    expect(bad({ rankWeights: [Number.NaN] })).toBe(false);
    expect(bad({ maxTeams: -1 })).toBe(false);
  });

  it("refuses two projects with one key", () => {
    const [first] = WORKSPACE.projects;
    const twice = {
      ...WORKSPACE,
      projects: [first, { ...first, title: "Other" }],
    };
    expect(parseWorkspace(JSON.stringify(twice)).ok).toBe(false);
  });
});

describe("isEmptyWorkspace", () => {
  it("is true for the empty workspace after a round trip through a file", () => {
    const parsed = parseWorkspace(serializeWorkspace(EMPTY_WORKSPACE));
    expect(parsed.ok && isEmptyWorkspace(parsed.workspace)).toBe(true);
  });

  it("is false once there are projects, bids or changed parameters", () => {
    expect(isEmptyWorkspace(WORKSPACE)).toBe(false);
    expect(
      isEmptyWorkspace({
        ...EMPTY_WORKSPACE,
        parameters: { ...EMPTY_WORKSPACE.parameters, minStudents: 2 },
      })
    ).toBe(false);
  });
});

describe("toPlacementInput", () => {
  it("gives a project with no max teams of its own the page default", () => {
    const input = toPlacementInput(WORKSPACE, [], WORKSPACE.projects);
    expect(input.projects.map((p) => p.maxTeams)).toEqual([3, 2]);
    expect(input.parameters).not.toHaveProperty("maxTeams");
  });
});

describe("projectsFromPortal", () => {
  it("keys by id, takes max teams from teams supported, and reports shared titles", () => {
    const result = projectsFromPortal([
      { id: "a", title: "Tide Clock", teamsSupported: 2 },
      { id: "b", title: "tide  clock", teamsSupported: 1 },
      { id: "c", title: "Robot Arm", teamsSupported: 1 },
    ]);
    expect(result.projects.map((p) => [p.key, p.maxTeams])).toEqual([
      ["a", 2],
      ["b", 1],
      ["c", 1],
    ]);
    expect(result.duplicates).toEqual(["tide  clock"]);
  });
});

describe("title matches", () => {
  const matches = {
    "robot arm contoller": {
      projectKey: "robot arm",
      title: "Robot Arm Contoller",
    },
    "moon base": { projectKey: "gone", title: "Moon Base" },
  };

  it("round-trip through a file", () => {
    const workspace = { ...WORKSPACE, titleMatches: matches };
    expect(parseWorkspace(serializeWorkspace(workspace))).toEqual({
      ok: true,
      workspace,
    });
  });

  it("keep the matches whose project is still there", () => {
    expect(pruneTitleMatches(matches, WORKSPACE.projects)).toEqual({
      "robot arm contoller": matches["robot arm contoller"],
    });
    expect(pruneTitleMatches(matches, [{ key: "other" }])).toBe(undefined);
    expect(pruneTitleMatches(undefined, WORKSPACE.projects)).toBe(undefined);
  });

  it("change the fingerprint, and none or an empty set leave it alone", () => {
    const base = { ...WORKSPACE, titleMatches: undefined, roster: undefined };
    expect(inputFingerprint({ ...base, titleMatches: {} })).toBe(
      inputFingerprint(base)
    );
    expect(inputFingerprint({ ...base, titleMatches: matches })).not.toBe(
      inputFingerprint(base)
    );
  });
});

describe("the roster", () => {
  const roster = {
    source: { kind: "pasted" as const },
    text: "ada@example.edu\nkim@example.edu",
  };

  it("round-trips through a file", () => {
    const workspace = { ...WORKSPACE, roster };
    expect(parseWorkspace(serializeWorkspace(workspace))).toEqual({
      ok: true,
      workspace,
    });
  });

  it("changes the fingerprint, and none leaves it as before", () => {
    const base = { ...WORKSPACE, titleMatches: undefined, roster: undefined };
    expect(inputFingerprint({ ...base, roster })).not.toBe(
      inputFingerprint(base)
    );
  });

  it("keeps a workspace that holds only a roster from counting as empty", () => {
    expect(isEmptyWorkspace({ ...EMPTY_WORKSPACE, roster })).toBe(false);
  });
});

describe("removed students", () => {
  const result: StoredResult = {
    at: "2026-09-28T10:00:00.000Z",
    fingerprint: "f",
    status: "optimal",
    gap: null,
    objective: 100,
    placements: [
      {
        email: "ada@example.edu",
        projectKey: "robot arm",
        team: 1,
        priority: 1,
      },
      {
        email: "kim@example.edu",
        projectKey: "robot arm",
        team: 1,
        priority: 2,
      },
    ],
    unplaced: [{ email: "cy@example.edu", reason: "no_eligible_project" }],
    diagnostics: {
      pinnedProjectsBelowMin: [],
      pinOverflow: [],
      projectsBelowMin: [],
      requiredSeatShortfall: null,
      seatShortfall: null,
    },
  };

  it("take students off the shown placement and mark it edited", () => {
    const next = removeStudents({ ...WORKSPACE, result }, [
      "kim@example.edu",
      "cy@example.edu",
    ]);
    expect(next.removed).toEqual(["cy@example.edu", "kim@example.edu"]);
    expect(next.result?.placements.map((p) => p.email)).toEqual([
      "ada@example.edu",
    ]);
    expect(next.result?.unplaced).toEqual([]);
    expect(next.result?.edited).toBe(true);
  });

  it("leave a placement they were not on as it was", () => {
    const next = removeStudents({ ...WORKSPACE, result }, ["zed@example.edu"]);
    expect(next.result).toBe(result);
    expect(removeStudents(next, ["zed@example.edu"]).removed).toEqual([
      "zed@example.edu",
    ]);
  });

  it("come back one at a time, and the list goes once it is empty", () => {
    const next = removeStudents(WORKSPACE, [
      "ada@example.edu",
      "kim@example.edu",
    ]);
    expect(restoreStudent(next, "kim@example.edu").removed).toEqual([
      "ada@example.edu",
    ]);
    expect(
      restoreStudent(restoreStudent(next, "kim@example.edu"), "ada@example.edu")
        .removed
    ).toBe(undefined);
  });

  it("are set aside from the students, named when the bids or roster list them", () => {
    const students = [
      { email: "ada@example.edu", name: "Ada Park", bids: [] },
      { email: "kim@example.edu", name: "Kim Lee", bids: [] },
    ];
    const aside = setAsideRemoved(students, [
      "kim@example.edu",
      "gone@example.edu",
    ]);
    expect(aside.kept.map((s) => s.email)).toEqual(["ada@example.edu"]);
    expect(aside.removed).toEqual([
      { email: "kim@example.edu", name: "Kim Lee", listed: true },
      { email: "gone@example.edu", name: "", listed: false },
    ]);
  });

  it("are read in lowercase from a hand-edited file, as the parsers write emails", () => {
    const parsed = parseWorkspace(
      JSON.stringify({ ...WORKSPACE, removed: ["Ada@Example.edu"] })
    );
    expect(parsed.ok && parsed.workspace.removed).toEqual(["ada@example.edu"]);
  });

  it("round-trip through a file and keep a workspace from counting as empty", () => {
    const workspace = { ...WORKSPACE, removed: ["ada@example.edu"] };
    expect(parseWorkspace(serializeWorkspace(workspace))).toEqual({
      ok: true,
      workspace,
    });
    expect(
      isEmptyWorkspace({ ...EMPTY_WORKSPACE, removed: ["ada@example.edu"] })
    ).toBe(false);
  });
});

describe("isStale", () => {
  const result = { fingerprint: "abc" } as StoredResult;

  it("is stale only when a result ran on other inputs", () => {
    expect(isStale(undefined, "abc")).toBe(false);
    expect(isStale(result, "abc")).toBe(false);
    expect(isStale(result, "abd")).toBe(true);
  });
});
