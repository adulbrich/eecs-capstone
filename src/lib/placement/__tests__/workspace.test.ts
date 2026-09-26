import { describe, expect, it } from "vitest";
import {
  EMPTY_WORKSPACE,
  isEmptyWorkspace,
  parseWorkspace,
  projectsFromPortal,
  serializeWorkspace,
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
    const input = toPlacementInput(WORKSPACE, []);
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
