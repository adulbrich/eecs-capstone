import { describe, expect, it } from "vitest";
import { detectPlugin } from "#/lib/placement/plugins";
import { canvasRoster } from "#/lib/placement/plugins/canvas";
import { parseRosterCsv } from "#/lib/placement/roster";

// Invented names and emails only (#648).

/** The export through the plugin, then the roster parser, as the page reads it. */
function readCanvas(text: string) {
  const converted = canvasRoster.toStandard(text, { projects: [] });
  const parsed = parseRosterCsv(converted.text);
  return {
    entries: parsed.entries,
    issues: converted.issues,
    parseIssues: parsed.issues,
  };
}

describe("the Canvas roster and groups export (#674)", () => {
  const HEADER =
    "name,canvas_user_id,user_id,login_id,sections,group_name,canvas_group_id,group_id";

  it("reads login_id as the email and group_name as the project", () => {
    const canvas = readCanvas(
      [
        HEADER,
        "Ada Park,101,9001,Ada@Example.edu,CS 461,Tide Clock,55,7",
        "Kim Lee,102,9002,kim@example.edu,CS 461,,,",
        "Test Student,103,,,CS 461,,,",
        "Lou Ma,104,9004,lmau,CS 461,Team 3,56,8",
      ].join("\n")
    );
    expect(canvas.entries).toEqual(
      parseRosterCsv(
        "email,name,project\nada@example.edu,Ada Park,Tide Clock\nkim@example.edu,Kim Lee,\n"
      ).entries
    );
    // A login that is not an email stays an error: no domain is appended,
    // so the plugin reads any institution's Canvas the same way.
    expect(canvas.issues).toEqual([
      {
        level: "warning",
        row: 4,
        message: "Canvas's Test Student has no login_id, and is left out.",
      },
      { level: "error", row: 5, message: '"lmau" is not an email.' },
    ]);
    expect(canvas.parseIssues).toEqual([]);
  });

  it("credits a group to the row it came from when a student is listed three times", () => {
    const canvas = readCanvas(
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
    const canvas = readCanvas(
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

  it("leaves a group that names no project blank, reported once", () => {
    const canvas = readCanvas(
      [HEADER, "Ada Park,101,9001,ada@example.edu,CS 461,...,55,7"].join("\n")
    );
    expect(canvas.entries).toEqual([
      { email: "ada@example.edu", name: "Ada Park" },
    ]);
    expect(canvas.issues).toHaveLength(1);
    expect(canvas.parseIssues).toEqual([]);
  });

  it("is detected by login_id, and a file with email is the roster's own", () => {
    expect(detectPlugin("roster", "name,login_id\n")).toBe(canvasRoster);
    expect(
      detectPlugin("roster", "email,login_id,project\nada@example.edu,x,y")
    ).toBeNull();
    expect(detectPlugin("roster", "name,group_name\nAda,Team 1")).toBeNull();
    expect(parseRosterCsv("name,group_name\nAda,Team 1").issues).toEqual([
      {
        level: "error",
        row: 1,
        message: 'The file has no "email" column.',
        wholeFile: true,
      },
    ]);
  });

  it("says login_id is missing when staff force a file without it through Canvas", () => {
    expect(readCanvas("name,email\nAda,ada@example.edu").issues).toEqual([
      {
        level: "error",
        row: 1,
        message: 'The file has no "login_id" column.',
        wholeFile: true,
      },
    ]);
  });
});
