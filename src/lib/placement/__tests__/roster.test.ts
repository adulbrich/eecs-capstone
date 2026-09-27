import { describe, expect, it } from "vitest";
import {
  mergeRoster,
  parseRosterCsv,
  parseRosterList,
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
    });
  });

  it("reports a missing email column, a bad email and a repeat", () => {
    expect(parseRosterCsv("name\nAda").issues).toEqual([
      { level: "error", row: 1, message: 'The file has no "email" column.' },
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

  it("gives the same students as a CSV of the same emails", () => {
    expect(parseRosterList("ada@example.edu\nkim@example.edu").entries).toEqual(
      parseRosterCsv("email\nada@example.edu\nkim@example.edu").entries
    );
  });

  it("gives nothing for blank text", () => {
    expect(parseRosterList(" \n ,; \n")).toEqual({ entries: [], issues: [] });
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
    expect(merged).toEqual({ students: survey, notOnRoster: [] });
  });
});
