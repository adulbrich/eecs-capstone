import { describe, expect, it } from "vitest";
import type { WorkspaceProject } from "#/lib/placement/types";
import {
  addProject,
  contactFor,
  EMPTY_WORKSPACE,
  inputFingerprint,
  isEmptyWorkspace,
  isStale,
  parseWorkspace,
  projectsFromPortal,
  pruneTitleMatches,
  removeProject,
  removeStudents,
  restoreStudent,
  type StoredResult,
  serializeWorkspace,
  setAsideRemoved,
  toPlacementInput,
  type Workspace,
  withoutContact,
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

  it("carries the proposer, the mentor and student proposed, falling back to the contact for a missing proposer", () => {
    const { projects } = projectsFromPortal([
      {
        id: "a",
        title: "Tide Clock",
        teamsSupported: 1,
        proposerName: "Jane Doe",
        proposerEmail: "jane@example.com",
        contactName: "Front Desk",
        contactEmail: "desk@example.com",
        mentorName: null,
        mentorEmail: " ",
        studentProposed: false,
      },
      {
        id: "b",
        title: "Robot Arm",
        teamsSupported: 1,
        proposerName: null,
        proposerEmail: null,
        contactName: "Front Desk",
        contactEmail: "desk@example.com",
        mentorName: "Pat Lee",
        mentorEmail: "leep@example.edu",
        studentProposed: true,
      },
    ]);
    const blank = projectsFromPortal([
      {
        id: "c",
        title: "Moon Base",
        teamsSupported: 1,
        proposerName: " ",
        proposerEmail: null,
        contactName: "Front Desk",
        contactEmail: null,
      },
    ]);
    // A proposer that trims to nothing is no proposer.
    expect(blank.projects[0].proposerName).toBe("Front Desk");
    expect(projects.map(contactFields)).toEqual([
      { proposerName: "Jane Doe", proposerEmail: "jane@example.com" },
      {
        proposerName: "Front Desk",
        proposerEmail: "desk@example.com",
        mentorName: "Pat Lee",
        mentorEmail: "leep@example.edu",
        studentProposed: true,
      },
    ]);
  });
});

/** The contact fields that are set, as a saved workspace keeps them. */
const contactFields = (p: WorkspaceProject) =>
  JSON.parse(
    JSON.stringify({
      proposerName: p.proposerName,
      proposerEmail: p.proposerEmail,
      mentorName: p.mentorName,
      mentorEmail: p.mentorEmail,
      studentProposed: p.studentProposed,
    })
  );

describe("contactFor", () => {
  const both = {
    proposerName: "Jane Doe",
    proposerEmail: "jane@example.com",
    mentorName: "Pat Lee",
    mentorEmail: "leep@example.edu",
  };

  it("names the proposer, or the mentor for a student-proposed project", () => {
    expect(contactFor(both)).toEqual({
      name: "Jane Doe",
      email: "jane@example.com",
      role: "proposer",
    });
    expect(contactFor({ ...both, studentProposed: true })?.role).toBe("mentor");
  });

  it("falls back to the other when the preferred one is missing, and is null for neither", () => {
    expect(
      contactFor({ studentProposed: true, proposerEmail: "jane@example.com" })
    ).toEqual({ email: "jane@example.com", name: undefined, role: "proposer" });
    expect(contactFor({ mentorName: "Pat Lee" })?.role).toBe("mentor");
    expect(contactFor({})).toBe(null);
  });

  it("reads a name of spaces as none, so a real proposer wins over it", () => {
    expect(
      contactFor({
        studentProposed: true,
        mentorName: "  ",
        proposerName: "Jane Doe",
      })
    ).toEqual({ email: undefined, name: "Jane Doe", role: "proposer" });
  });

  it("reads a blank name as none, so the email shows", () => {
    expect(contactFor({ proposerName: "", proposerEmail: "a@b.c" })).toEqual({
      email: "a@b.c",
      name: undefined,
      role: "proposer",
    });
  });
});

describe("contact fields", () => {
  const contact = {
    proposerName: "Jane Doe",
    proposerEmail: "jane@example.com",
    studentProposed: true,
  };

  it("never change the fingerprint, so loading them leaves a run current", () => {
    const base = { ...WORKSPACE, titleMatches: undefined, roster: undefined };
    const withContact = {
      ...base,
      projects: base.projects.map((p) => ({ ...p, ...contact })),
    };
    expect(inputFingerprint(withContact)).toBe(inputFingerprint(base));
  });

  it("leave a project without them hashing to the same text as before", () => {
    // The fingerprint stringifies each project after dropping the contact
    // fields; a project that never had any must serialize byte for byte as
    // it did, or every saved run would go stale on upgrade.
    for (const project of WORKSPACE.projects) {
      expect(JSON.stringify(withoutContact(project))).toBe(
        JSON.stringify(project)
      );
    }
  });

  it("round-trip through a saved workspace and stay out of a run's input", () => {
    const workspace = {
      ...WORKSPACE,
      projects: WORKSPACE.projects.map((p) => ({ ...p, ...contact })),
    };
    expect(parseWorkspace(serializeWorkspace(workspace))).toEqual({
      ok: true,
      workspace,
    });
    const input = toPlacementInput(workspace, [], workspace.projects);
    for (const project of input.projects) {
      expect(project).not.toHaveProperty("proposerEmail");
      expect(project).not.toHaveProperty("studentProposed");
    }
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

const RESULT: StoredResult = {
  at: "2026-09-29T10:00:00.000Z",
  fingerprint: "f",
  status: "optimal",
  gap: null,
  objective: 100,
  placements: [
    { email: "ada@example.edu", projectKey: "robot arm", team: 1, priority: 1 },
  ],
  unplaced: [],
  diagnostics: {
    pinnedProjectsBelowMin: [],
    pinOverflow: [],
    projectsBelowMin: [],
    requiredSeatShortfall: null,
    seatShortfall: null,
  },
};

describe("addProject", () => {
  const moon = { title: "Moon  Base", weightMultiplier: 1 };

  it("adds a project keyed by its normalized title, marked as added by hand, keeping pins and the run", () => {
    const withRun = {
      ...WORKSPACE,
      pins: { "ada@example.edu": "robot arm" },
      result: RESULT,
    };
    const added = addProject(withRun, moon);
    expect(added.ok).toBe(true);
    if (!added.ok) {
      return;
    }
    expect(added.workspace.projects.at(-1)).toEqual({
      key: "moon base",
      title: "Moon  Base",
      weightMultiplier: 1,
      addedByHand: true,
    });
    expect(added.workspace.pins).toEqual(withRun.pins);
    expect(added.workspace.result).toBe(RESULT);
    expect(added.workspace.projectSource).toEqual(WORKSPACE.projectSource);
  });

  it("refuses a title a listed project has", () => {
    expect(addProject(WORKSPACE, { ...moon, title: "robot ARM" })).toEqual({
      ok: false,
      message: "A project with this title is already in the list.",
    });
  });

  it("names a list built from empty as added by hand, and saves it", () => {
    const added = addProject(
      { ...WORKSPACE, projects: [], projectSource: null },
      moon
    );
    expect(added.ok && added.workspace.projectSource).toEqual({
      kind: "manual",
    });
    if (added.ok) {
      expect(parseWorkspace(serializeWorkspace(added.workspace))).toEqual({
        ok: true,
        workspace: added.workspace,
      });
    }
  });

  it("takes over a project the roster added under the same title, pins included", () => {
    const added = addProject(
      { ...WORKSPACE, pins: { "kim@example.edu": "roster:moon base" } },
      moon
    );
    expect(added.ok && added.workspace.pins).toEqual({
      "kim@example.edu": "moon base",
    });
  });
});

describe("removeProject", () => {
  it("drops the project and the titles matched to it, keeping pins and the run", () => {
    const workspace = {
      ...WORKSPACE,
      pins: { "ada@example.edu": "robot arm" },
      result: RESULT,
      titleMatches: {
        "robot arm contoller": {
          projectKey: "robot arm",
          title: "Robot Arm Contoller",
        },
        "tide clok": { projectKey: "tide clock", title: "Tide Clok" },
      },
    };
    const removed = removeProject(workspace, "robot arm");
    expect(removed.projects.map((p) => p.key)).toEqual(["tide clock"]);
    expect(removed.titleMatches).toEqual({
      "tide clok": workspace.titleMatches["tide clok"],
    });
    expect(removed.pins).toEqual(workspace.pins);
    expect(removed.result).toBe(RESULT);
    expect(removed.projectSource).toEqual(WORKSPACE.projectSource);
  });

  it("clears the source with the last project", () => {
    const one = removeProject(WORKSPACE, "robot arm");
    expect(removeProject(one, "tide clock").projectSource).toBe(null);
  });
});
