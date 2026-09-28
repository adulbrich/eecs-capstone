import { describe, expect, it } from "vitest";
import {
  mergeRoster,
  parseRosterCsv,
  parseRosterList,
  repointRosterPins,
  resolveRosterProjects,
  rosterProjectKey,
} from "#/lib/placement/roster";

// Invented names and emails only (#648).

describe("parseRosterCsv", () => {
  it("reads email and an optional name, lowercasing the email", () => {
    expect(
      parseRosterCsv("Email,Name\nAda@Example.edu,Ada Park\nkim@example.edu,\n")
    ).toEqual({
      entries: [
        { email: "ada@example.edu", name: "Ada Park" },
        { email: "kim@example.edu", name: "" },
      ],
      issues: [],
      format: "roster",
    });
  });

  it("reports a missing email column, a bad email and a repeat", () => {
    expect(parseRosterCsv("name\nAda").issues).toEqual([
      {
        level: "error",
        row: 1,
        message: 'The file has no "email" column.',
        wholeFile: true,
      },
    ]);
    const parsed = parseRosterCsv(
      "email\nada@example.edu\nnot an email\n\nADA@example.edu"
    );
    expect(parsed.entries).toEqual([{ email: "ada@example.edu", name: "" }]);
    expect(parsed.issues).toEqual([
      { level: "error", row: 3, message: '"not an email" is not an email.' },
      {
        level: "warning",
        row: 4,
        message: "ada@example.edu is already on row 2; keeping the first.",
      },
    ]);
  });
});

describe("parseRosterList", () => {
  it("takes one per line, separators, Name <email>, and a name column beside the email", () => {
    const parsed = parseRosterList(
      [
        "ada@example.edu",
        "",
        "ben@example.edu, cy@example.edu; dee@example.edu",
        "eve@example.edu fay@example.edu",
        'Kim Lee <KIM@example.edu>, "Lou Ma" <lou@example.edu>',
        "Max Ng\tmax@example.edu",
      ].join("\n")
    );
    expect(parsed.issues).toEqual([]);
    expect(parsed.entries).toEqual([
      { email: "ada@example.edu", name: "" },
      { email: "ben@example.edu", name: "" },
      { email: "cy@example.edu", name: "" },
      { email: "dee@example.edu", name: "" },
      { email: "eve@example.edu", name: "" },
      { email: "fay@example.edu", name: "" },
      { email: "kim@example.edu", name: "Kim Lee" },
      { email: "lou@example.edu", name: "Lou Ma" },
      { email: "max@example.edu", name: "Max Ng" },
    ]);
  });

  it("reports what is not an email by line, and a repeat as a warning", () => {
    const parsed = parseRosterList(
      "ada@example.edu\nnobody\nada@example.edu\nx@y.edu z@y.edu extra\nKim <kim>"
    );
    expect(parsed.entries).toEqual([{ email: "ada@example.edu", name: "" }]);
    expect(parsed.issues).toEqual([
      { level: "error", row: 2, message: '"nobody" is not an email.' },
      {
        level: "warning",
        row: 3,
        message: "ada@example.edu is already on line 1; keeping the first.",
      },
      { level: "error", row: 4, message: '"extra" is not an email.' },
      { level: "error", row: 5, message: '"kim" is not an email.' },
    ]);
  });

  it("keeps a comma inside a quoted name as part of the name", () => {
    expect(
      parseRosterList('"Park, Ada" <ada@example.edu>; ben@example.edu')
    ).toEqual({
      entries: [
        { email: "ada@example.edu", name: "Park, Ada" },
        { email: "ben@example.edu", name: "" },
      ],
      issues: [],
      format: "roster",
    });
  });

  it("gives the same students as a CSV of the same emails", () => {
    expect(parseRosterList("ada@example.edu\nkim@example.edu").entries).toEqual(
      parseRosterCsv("email\nada@example.edu\nkim@example.edu").entries
    );
  });

  it("gives nothing for blank text", () => {
    expect(parseRosterList(" \n ,; \n")).toEqual({
      entries: [],
      issues: [],
      format: "roster",
    });
  });
});

describe("mergeRoster", () => {
  const survey = [
    { email: "ada@example.edu", name: "Ada Park", bids: [] },
    { email: "ben@example.edu", name: "Ben Ito", bids: [] },
  ];

  it("adds a roster student the survey lacks, with no bids, and keeps the survey's name", () => {
    const merged = mergeRoster(survey, [
      { email: "ada@example.edu", name: "A. Park" },
      { email: "kim@example.edu", name: "Kim Lee" },
    ]);
    expect(merged.students).toEqual([
      ...survey,
      { email: "kim@example.edu", name: "Kim Lee", bids: [], rosterOnly: true },
    ]);
    expect(merged.notOnRoster).toEqual(["ben@example.edu"]);
  });

  it("changes nothing when the roster is the survey", () => {
    const merged = mergeRoster(
      survey,
      survey.map((s) => ({ email: s.email, name: "" }))
    );
    expect(merged).toEqual({
      students: survey,
      notOnRoster: [],
      conflicts: [],
    });
  });
});

describe("pre-approvals on the roster (#670)", () => {
  const projects = [
    { key: "p1", title: "Tide Clock", weightMultiplier: 1 },
    { key: "p2", title: "Robot Arm Controller", weightMultiplier: 1 },
  ];

  it("reads a project column, leaving it off a row that has none", () => {
    expect(
      parseRosterCsv(
        "email,project\nada@example.edu,Tide Clock\nben@example.edu,\n"
      ).entries
    ).toEqual([
      { email: "ada@example.edu", name: "", project: "Tide Clock" },
      { email: "ben@example.edu", name: "" },
    ]);
  });

  it("resolves a listed title, a matched title, and adds an unlisted one", () => {
    const resolved = resolveRosterProjects(
      [
        { email: "ada@example.edu", name: "", project: "tide clock." },
        { email: "ben@example.edu", name: "", project: "Robo Arm" },
        { email: "cy@example.edu", name: "", project: "Sponsor Lab" },
        { email: "dee@example.edu", name: "", project: "sponsor lab" },
        { email: "eve@example.edu", name: "" },
      ],
      projects,
      { "robo arm": { projectKey: "p2" } }
    );
    const sponsor = rosterProjectKey("sponsor lab");
    expect(Object.fromEntries(resolved.pins)).toEqual({
      "ada@example.edu": "p1",
      "ben@example.edu": "p2",
      "cy@example.edu": sponsor,
      "dee@example.edu": sponsor,
    });
    expect(resolved.added).toEqual([
      {
        key: sponsor,
        title: "Sponsor Lab",
        maxTeams: 1,
        minStudents: 1,
        maxStudents: 2,
        weightMultiplier: 1,
        fromRoster: true,
      },
    ]);
    expect(resolved.nearMisses).toEqual([]);
  });

  it("flags an added title close to a listed project", () => {
    const resolved = resolveRosterProjects(
      [{ email: "ada@example.edu", name: "", project: "Robot Arm Contoller" }],
      projects
    );
    expect(resolved.nearMisses).toEqual([
      {
        key: "robot arm contoller",
        title: "Robot Arm Contoller",
        suggestion: expect.objectContaining({ key: "p2" }),
      },
    ]);
  });

  it("pins survey and roster students, over a bids file pin, and lists the conflict", () => {
    const merged = mergeRoster(
      [
        { email: "ada@example.edu", name: "Ada", bids: [], pin: "p2" },
        { email: "ben@example.edu", name: "Ben", bids: [] },
      ],
      [
        { email: "ada@example.edu", name: "", project: "Tide Clock" },
        { email: "ben@example.edu", name: "" },
        { email: "kim@example.edu", name: "Kim", project: "Tide Clock" },
      ],
      new Map([
        ["ada@example.edu", "p1"],
        ["kim@example.edu", "p1"],
      ])
    );
    expect(merged.students).toEqual([
      {
        email: "ada@example.edu",
        name: "Ada",
        bids: [],
        pin: "p1",
        preApproved: true,
      },
      { email: "ben@example.edu", name: "Ben", bids: [] },
      {
        email: "kim@example.edu",
        name: "Kim",
        bids: [],
        rosterOnly: true,
        pin: "p1",
        preApproved: true,
      },
    ]);
    expect(merged.conflicts).toEqual([
      { email: "ada@example.edu", fromBids: "p2", fromRoster: "p1" },
    ]);
  });
});

describe("pre-approval edge cases (#670)", () => {
  it("warns about a project cell that names nothing", () => {
    const parsed = parseRosterCsv("email,project\nada@example.edu,...\n");
    expect(parsed.entries).toEqual([
      { email: "ada@example.edu", name: "", project: "..." },
    ]);
    expect(parsed.issues).toEqual([
      {
        level: "warning",
        row: 2,
        message:
          '"..." names no project, so ada@example.edu is not pre-approved.',
      },
    ]);
  });

  it("moves board pins off a roster project a new match makes listed", () => {
    expect(
      repointRosterPins(
        {
          "ada@example.edu": rosterProjectKey("robot arm contoller"),
          "ben@example.edu": "p1",
          "cy@example.edu": null,
        },
        { "robot arm contoller": { projectKey: "p2" } }
      )
    ).toEqual({
      "ada@example.edu": "p2",
      "ben@example.edu": "p1",
      "cy@example.edu": null,
    });
    expect(repointRosterPins(undefined, {})).toBeUndefined();
  });
});

describe("the Canvas roster and groups export (#674)", () => {
  const HEADER =
    "name,canvas_user_id,user_id,login_id,sections,group_name,canvas_group_id,group_id";

  it("reads login_id as the email and group_name as the project", () => {
    const canvas = parseRosterCsv(
      [
        HEADER,
        "Ada Park,101,9001,Ada@Example.edu,CS 461,Tide Clock,55,7",
        "Kim Lee,102,9002,kim@example.edu,CS 461,,,",
        "Test Student,103,,,CS 461,,,",
        "Lou Ma,104,9004,lmau,CS 461,Team 3,56,8",
      ].join("\n")
    );
    expect(canvas.format).toBe("canvas");
    expect(canvas.entries).toEqual(
      parseRosterCsv(
        "email,name,project\nada@example.edu,Ada Park,Tide Clock\nkim@example.edu,Kim Lee,\n"
      ).entries
    );
    expect(canvas.issues).toEqual([
      {
        level: "warning",
        row: 4,
        message: "Canvas's Test Student has no login_id, and is left out.",
      },
      { level: "error", row: 5, message: '"lmau" is not an email.' },
    ]);
  });

  it("credits a group to the row it came from when a student is listed three times", () => {
    const canvas = parseRosterCsv(
      [
        HEADER,
        "Ada Park,101,9001,ada@example.edu,CS 461,,,",
        "Ada Park,101,9001,ada@example.edu,Lab 1,Team A,55,7",
        "Ada Park,101,9001,ada@example.edu,Lab 2,Team B,56,8",
      ].join("\n")
    );
    expect(canvas.entries).toEqual([
      { email: "ada@example.edu", name: "Ada Park", project: "Team A" },
    ]);
    expect(canvas.issues.at(-1)?.message).toBe(
      'ada@example.edu already has "Team A" from row 3; "Team B" here is ignored.'
    );
  });

  it("takes a later group when the first row has none, and names a second group it ignores", () => {
    const canvas = parseRosterCsv(
      [
        HEADER,
        "Ada Park,101,9001,ada@example.edu,CS 461,,,",
        "Ada Park,101,9001,ada@example.edu,CS 461 lab,Tide Clock,55,7",
        "Kim Lee,102,9002,kim@example.edu,CS 461,Sponsor Lab,56,8",
        "Kim Lee,102,9002,kim@example.edu,CS 461 lab,Robot Arm,57,9",
        "Lou Ma,103,,,CS 461,,,",
      ].join("\n")
    );
    expect(canvas.entries).toEqual([
      { email: "ada@example.edu", name: "Ada Park", project: "Tide Clock" },
      { email: "kim@example.edu", name: "Kim Lee", project: "Sponsor Lab" },
    ]);
    expect(canvas.issues).toEqual([
      {
        level: "warning",
        row: 3,
        message:
          'ada@example.edu is already on row 2, with no project; taking "Tide Clock" from this row.',
      },
      {
        level: "warning",
        row: 5,
        message:
          'kim@example.edu already has "Sponsor Lab" from row 4; "Robot Arm" here is ignored.',
      },
      // Only Canvas's own Test Student gets the gentler message.
      { level: "error", row: 6, message: "The row has no login_id." },
    ]);
  });

  it("reads a header with login_id as Canvas, and asks for email when neither is there", () => {
    expect(parseRosterCsv("name,login_id\n").format).toBe("canvas");
    expect(parseRosterCsv("name,group_name\nAda,Team 1").issues).toEqual([
      {
        level: "error",
        row: 1,
        message: 'The file has no "email" column.',
        wholeFile: true,
      },
    ]);
  });

  it("reads email, not login_id, when a file has both", () => {
    const both = parseRosterCsv(
      "email,login_id,project\nada@example.edu,other@example.edu,Tide Clock"
    );
    expect(both.format).toBe("roster");
    expect(both.entries).toEqual([
      { email: "ada@example.edu", name: "", project: "Tide Clock" },
    ]);
  });
});
