import { describe, expect, it } from "vitest";
import {
  normalizeTitle,
  parseBidsCsv,
  parseProjectsCsv,
} from "#/lib/placement/csv";

// Every name, email and title here is invented (#648).

const PROJECTS = [
  { key: "p1", title: "Robot Arm" },
  { key: "p2", title: "Garden  Planner" },
  { key: "p3", title: "Tide Clock" },
];

const HEADER = "email,name,priority,project,comment,override,avoid";

function bids(...lines: string[]) {
  return parseBidsCsv([HEADER, ...lines].join("\n"), PROJECTS);
}

const errors = (result: { issues: { level: string; row: number }[] }) =>
  result.issues.filter((i) => i.level === "error").map((i) => i.row);

describe("normalizeTitle", () => {
  it("trims, folds case and collapses inner whitespace", () => {
    expect(normalizeTitle("  Garden \t Planner ")).toBe("garden planner");
  });
});

describe("parseBidsCsv", () => {
  it("builds one student per email with bids in file order", () => {
    const result = bids(
      "Ada@Example.edu,Ada Park,1,robot arm,Love motors,,",
      "ada@example.edu,Ada Park,2,Garden Planner,,,"
    );
    expect(result.issues).toEqual([]);
    expect(result.students).toEqual([
      {
        email: "ada@example.edu",
        name: "Ada Park",
        bids: [
          { projectKey: "p1", priority: 1, comment: "Love motors" },
          { projectKey: "p2", priority: 2, comment: "" },
        ],
      },
    ]);
  });

  it("reads a quoted comment with a comma and a newline", () => {
    const result = bids(
      'ada@example.edu,Ada,1,Tide Clock,"Tides, and\nclocks",,'
    );
    expect(result.students[0].bids[0].comment).toBe("Tides, and\nclocks");
  });

  it("reads a file with a byte order mark, CRLF endings and loose headers", () => {
    const text =
      "﻿ Email ,NAME,Priority,Project\r\nada@example.edu,Ada,1,Tide Clock\r\n";
    const result = parseBidsCsv(text, PROJECTS);
    expect(result.issues).toEqual([]);
    expect(result.students).toHaveLength(1);
  });

  it("names every missing required column", () => {
    const result = parseBidsCsv("email,name\nada@example.edu,Ada", PROJECTS);
    expect(result.issues.map((i) => i.message)).toEqual([
      'The file has no "priority" column.',
      'The file has no "project" column.',
    ]);
  });

  it("keeps each bad row out and reports it, and keeps the good rows", () => {
    const result = bids(
      ",Nobody,1,Tide Clock,,,",
      "ada@example.edu,Ada,1,,,,",
      "ada@example.edu,Ada,first,Tide Clock,,,",
      "ada@example.edu,Ada,0,Tide Clock,,,",
      "ada@example.edu,Ada,1,Moon Base,,,",
      "ada@example.edu,Ada,1,Tide Clock,,maybe,",
      "ada@example.edu,Ada,,Tide Clock,,,",
      "ada@example.edu,Ada,2,Robot Arm,,,"
    );
    expect(errors(result)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    expect(result.students[0].bids).toEqual([
      { projectKey: "p1", priority: 2, comment: "" },
    ]);
  });

  it("rejects a repeated priority, a repeated project and a second pin", () => {
    const result = bids(
      "ada@example.edu,Ada,1,Tide Clock,,true,",
      "ada@example.edu,Ada,1,Robot Arm,,,",
      "ada@example.edu,Ada,2,tide clock,,,",
      "ada@example.edu,Ada,3,Robot Arm,,yes,"
    );
    expect(errors(result)).toEqual([3, 4, 5]);
    expect(result.students[0].pin).toBe("p3");
  });

  it("accepts a pin with no priority as a project outside the bids", () => {
    const result = bids(
      "ada@example.edu,Ada,1,Tide Clock,,,",
      "ada@example.edu,Ada,,Robot Arm,,X,"
    );
    expect(result.issues).toEqual([]);
    expect(result.students[0]).toMatchObject({
      pin: "p1",
      bids: [{ projectKey: "p3", priority: 1, comment: "" }],
    });
  });

  it.each(["true", "TRUE", "yes", "y", "1", "x"])(
    "reads %s as a pin",
    (flag) => {
      expect(
        bids(`ada@example.edu,Ada,1,Tide Clock,,${flag},`).students[0].pin
      ).toBe("p3");
    }
  );

  it.each(["", "false", "no", "n", "0"])("reads %j as no pin", (flag) => {
    expect(
      bids(`ada@example.edu,Ada,1,Tide Clock,,${flag},`).students[0].pin
    ).toBeUndefined();
  });

  it("keeps the first avoid answer and warns on a differing name", () => {
    const result = bids(
      "ada@example.edu,Ada,1,Tide Clock,,,",
      "ada@example.edu,Ada P,2,Robot Arm,,,Sam from lab",
      "ada@example.edu,,3,Garden Planner,,,Someone else"
    );
    expect(result.students[0].avoid).toBe("Sam from lab");
    expect(result.students[0].name).toBe("Ada");
    expect(result.issues).toEqual([
      expect.objectContaining({ level: "warning", row: 3 }),
    ]);
  });

  it("refuses a header that names a column twice", () => {
    const result = parseBidsCsv(
      "email,priority,project,priority\nada@example.edu,1,Tide Clock,9",
      PROJECTS
    );
    expect(result.students).toEqual([]);
    expect(result.issues).toEqual([
      {
        level: "error",
        row: 1,
        message:
          'The header has "priority" more than once; each column must appear once.',
      },
    ]);
  });

  it("returns nothing for an empty file", () => {
    const result = parseBidsCsv("", PROJECTS);
    expect(result.students).toEqual([]);
    expect(errors(result)).toEqual([1, 1, 1]);
  });
});

describe("parseProjectsCsv", () => {
  it("reads titles and optional numbers, keyed by the normalized title", () => {
    const result = parseProjectsCsv(
      "title,max_teams,min_students,max_students\nRobot  Arm,2,,5\nTide Clock,,,"
    );
    expect(result.issues).toEqual([]);
    expect(result.projects).toEqual([
      {
        key: "robot arm",
        title: "Robot Arm",
        maxTeams: 2,
        minStudents: undefined,
        maxStudents: 5,
        weightMultiplier: 1,
      },
      {
        key: "tide clock",
        title: "Tide Clock",
        maxTeams: undefined,
        minStudents: undefined,
        maxStudents: undefined,
        weightMultiplier: 1,
      },
    ]);
  });

  it("accepts a one-column file", () => {
    expect(
      parseProjectsCsv("title\nRobot Arm\nTide Clock").projects
    ).toHaveLength(2);
  });

  it("keeps each bad row out and reports it", () => {
    const result = parseProjectsCsv(
      [
        "title,max_teams,min_students,max_students",
        ",1,,",
        "A,-1,,",
        "B,1.5,,",
        "C,,0,",
        "D,,5,3",
        "E,0,,",
        "e,1,,",
      ].join("\n")
    );
    expect(errors(result)).toEqual([2, 3, 4, 5, 6, 8]);
    expect(result.projects.map((p) => [p.title, p.maxTeams])).toEqual([
      ["E", 0],
    ]);
  });

  it("needs a title column", () => {
    expect(parseProjectsCsv("name\nRobot Arm").issues).toEqual([
      { level: "error", row: 1, message: 'The file has no "title" column.' },
    ]);
  });
});
