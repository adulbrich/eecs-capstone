import { describe, expect, it } from "vitest";
import {
  applyStatus,
  editedMapping,
  wideDraft,
} from "#/components/placement/column-mapping";
import { parseBidsCsv } from "#/lib/placement/csv";
import { toStandard } from "#/lib/placement/plugins";
import {
  type ColumnMapping,
  CUSTOM_MAPPINGS,
  droppedColumns,
  fileHeaders,
  fitToDataset,
  nameConvertedRows,
  parseMapping,
  presentIn,
  readsAs,
  serializeMapping,
  suggestMapping,
  unmappedRequired,
} from "#/lib/placement/plugins/custom-mapping";
import { parseRosterCsv } from "#/lib/placement/roster";

// Invented people on example.edu only (#648).

const FILE = [
  "Team,Full Name,Student Email",
  "Tide Clock,Ada Park,ada@example.edu",
  ",Kim Lee,kim@example.edu",
].join("\n");

const MAPPING: ColumnMapping = {
  version: 1,
  dataset: "roster",
  columns: { "Student Email": "email", "Full Name": "name", Team: "project" },
};

const read = (text: string, mapping?: ColumnMapping) =>
  CUSTOM_MAPPINGS.roster.toStandard(text, { projects: [], mapping });

describe("custom mapping (#735)", () => {
  it("renames and reorders the file's columns into the standard format", () => {
    const { issues, text } = read(FILE, MAPPING);
    expect(issues).toEqual([]);
    expect(text).toBe(
      [
        "email,name,project",
        "ada@example.edu,Ada Park,Tide Clock",
        "kim@example.edu,Kim Lee,",
      ].join("\r\n")
    );
    expect(parseRosterCsv(text).entries).toEqual([
      { email: "ada@example.edu", name: "Ada Park", project: "Tide Clock" },
      { email: "kim@example.edu", name: "Kim Lee" },
    ]);
  });

  it("leaves an unmapped optional column blank", () => {
    const { issues, text } = read(FILE, {
      ...MAPPING,
      columns: { "Student Email": "email" },
    });
    expect(issues).toEqual([]);
    expect(text).toBe(
      "email,name,project\r\nada@example.edu,,\r\nkim@example.edu,,"
    );
  });

  it("matches a header whatever its case or surrounding spaces", () => {
    const { issues } = read(FILE, {
      ...MAPPING,
      columns: { " student EMAIL ": "email" },
    });
    expect(issues).toEqual([]);
  });

  it("blocks a mapping that leaves a required column unmapped", () => {
    const partial: ColumnMapping = {
      version: 1,
      dataset: "bids",
      columns: { Student: "email" },
    };
    expect(unmappedRequired(partial)).toEqual(["priority", "project"]);
    const { issues } = CUSTOM_MAPPINGS.bids.toStandard("Student\nada", {
      projects: [],
      mapping: partial,
    });
    expect(issues).toEqual([
      {
        level: "error",
        row: 1,
        message:
          'The column mapping leaves "priority", "project" unmapped, which the bids format requires.',
        wholeFile: true,
      },
    ]);
  });

  it("names the header a saved mapping reads that the file lacks", () => {
    const { issues, text } = read(
      "Student Email,Full Name\nada@example.edu,Ada Park",
      MAPPING
    );
    expect(issues).toEqual([
      {
        level: "error",
        row: 1,
        message:
          'The file has no "Team" column, which the column mapping reads as project.',
        wholeFile: true,
      },
    ]);
    // The header still, so a download of the conversion is a valid file.
    expect(text).toBe("email,name,project");
  });

  it("refuses a mapping made for another dataset, or none at all", () => {
    expect(read(FILE, { ...MAPPING, dataset: "bids" }).issues[0]?.message).toBe(
      "The column mapping is for the bids, not the roster."
    );
    expect(read(FILE).issues[0]?.wholeFile).toBe(true);
  });

  it("keeps a spreadsheet guard as the standard format keeps it", () => {
    const { text } = CUSTOM_MAPPINGS.projects.toStandard("Name\n'-Minus", {
      projects: [],
      mapping: { version: 1, dataset: "projects", columns: { Name: "title" } },
    });
    expect(text).toBe(
      "title,max_teams,min_students,max_students,proposer_name,proposer_email,mentor_name,mentor_email,student_proposed\r\n'-Minus,,,,,,,,"
    );
  });
});

describe("reading a file through a column mapping (#735)", () => {
  it("reads a file that starts with blank lines", () => {
    const blank = read(`\n\n${FILE}`, MAPPING);
    expect(blank.issues).toEqual([]);
    // The blank lines stay ahead of the header, so rows keep their numbers.
    expect(blank.text).toBe(`\r\n\r\n${read(FILE, MAPPING).text}`);
    expect(parseRosterCsv(blank.text).entries).toEqual(
      parseRosterCsv(read(FILE, MAPPING).text).entries
    );
  });

  it("keeps the file's row numbers through leading blank lines", () => {
    const { text } = read(
      "\n\nStudent Email,Full Name\nada@example.edu,Ada\nada@example.edu,Ada\n",
      { ...MAPPING, columns: { "Student Email": "email", "Full Name": "name" } }
    );
    // The repeated student is line 5 of the uploaded file.
    expect(parseRosterCsv(text).issues.map((i) => i.row)).toEqual([5]);
  });

  it("refuses two headers filling one column, rather than keep the last", () => {
    const { issues } = read(FILE, {
      ...MAPPING,
      columns: { "Student Email": "email", "Full Name": "email" },
    });
    expect(issues).toEqual([
      {
        level: "error",
        row: 1,
        message:
          'The column mapping fills email from "Student Email", "Full Name"; choose one.',
        wholeFile: true,
      },
    ]);
  });
});

describe("wide reading of a bids file (#736)", () => {
  const BIDS_HEADER = "email,name,priority,project,comment,override,avoid";

  // A Google Forms grid: the title inside the brackets of each header.
  const FORM = [
    "Timestamp,Email Address,Your name,Who to avoid,Rank the projects [Tide Clock],Rank the projects [Robot Arm],Rank the projects [Moon Base]",
    "2026-09-28 10:00,ada@example.edu,Ada Park,Sam Roe,2,1,",
    "2026-09-28 10:05,kim@example.edu,Kim Lee,,,,1",
  ].join("\n");

  const BRACKETS: ColumnMapping = {
    version: 2,
    dataset: "bids",
    columns: {
      "Email Address": "email",
      "Your name": "name",
      "Who to avoid": "avoid",
    },
    wide: {
      projectColumns: { by: "prefix", prefix: "Rank the projects" },
      title: { by: "brackets" },
    },
  };

  const readBids = (text: string, mapping?: ColumnMapping) =>
    CUSTOM_MAPPINGS.bids.toStandard(text, { projects: [], mapping });

  it("titles each project from the last square brackets, one bid per filled cell", () => {
    const { issues, text } = readBids(FORM, BRACKETS);
    expect(issues).toEqual([]);
    expect(text).toBe(
      [
        BIDS_HEADER,
        "ada@example.edu,Ada Park,2,Tide Clock,,,Sam Roe",
        "ada@example.edu,Ada Park,1,Robot Arm,,,Sam Roe",
        "kim@example.edu,Kim Lee,1,Moon Base,,,",
      ].join("\r\n")
    );
  });

  it("titles each project from the text after the first separator", () => {
    const { issues, text } = readBids(
      [
        "Student,Rank - Tide Clock,Rank - Robot Arm - Mk II",
        "ada@example.edu,1,2",
      ].join("\n"),
      {
        version: 2,
        dataset: "bids",
        columns: { Student: "email" },
        wide: {
          projectColumns: { by: "prefix", prefix: "rank" },
          title: { by: "separator", separator: " - " },
        },
      }
    );
    expect(issues).toEqual([]);
    expect(text).toBe(
      [
        BIDS_HEADER,
        "ada@example.edu,,1,Tide Clock,,,",
        "ada@example.edu,,2,Robot Arm - Mk II,,,",
      ].join("\r\n")
    );
  });

  it("reads the columns staff picked, and only those", () => {
    const { text } = readBids(FORM, {
      ...BRACKETS,
      wide: {
        ...BRACKETS.wide,
        projectColumns: {
          by: "headers",
          headers: ["rank the projects [robot arm]"],
        },
      } as ColumnMapping["wide"],
    });
    expect(text).toBe(
      [BIDS_HEADER, "ada@example.edu,Ada Park,1,Robot Arm,,,Sam Roe"].join(
        "\r\n"
      )
    );
  });

  it("reads a title with brackets of its own, and leaves priorities to the parser", () => {
    const { issues, text } = readBids(
      "Mail,Rank [Robot [v2]]\nada@example.edu,first",
      {
        version: 2,
        dataset: "bids",
        columns: { Mail: "email" },
        wide: {
          projectColumns: { by: "prefix", prefix: "Rank" },
          title: { by: "brackets" },
        },
      }
    );
    expect(issues).toEqual([]);
    expect(text).toBe(`${BIDS_HEADER}\r\nada@example.edu,,first,Robot [v2],,,`);
    // "first" is the parser's to refuse, in the converted file's rows.
    expect(parseBidsCsv(text, []).issues).toEqual([
      {
        level: "error",
        row: 2,
        message: "priority must be a whole number, 1 or more.",
      },
    ]);
  });

  it("emits nothing for a blank cell, and says so for a row with no bid", () => {
    const { issues, text } = readBids(
      `${FORM}\n2026-09-28 10:09,lou@example.edu,Lou Ma,,,,`,
      BRACKETS
    );
    expect(text.split("\r\n")).toHaveLength(4);
    expect(issues).toEqual([
      {
        level: "warning",
        row: 4,
        message:
          "The row has no priority in any project column, so it gives no bids.",
      },
    ]);
  });

  it("repeats the student columns on every bid, which the parser reads as one student", () => {
    const { text } = readBids(FORM, BRACKETS);
    const { issues, students } = parseBidsCsv(text, [
      { key: "tide clock", title: "Tide Clock" },
      { key: "robot arm", title: "Robot Arm" },
      { key: "moon base", title: "Moon Base" },
    ]);
    expect(issues).toEqual([]);
    expect(students).toEqual([
      {
        email: "ada@example.edu",
        name: "Ada Park",
        avoid: "Sam Roe",
        bids: [
          { projectKey: "tide clock", priority: 2, comment: "" },
          { projectKey: "robot arm", priority: 1, comment: "" },
        ],
      },
      {
        email: "kim@example.edu",
        name: "Kim Lee",
        bids: [{ projectKey: "moon base", priority: 1, comment: "" }],
      },
    ]);
  });

  const stops = (text: string, mapping: ColumnMapping) =>
    readBids(text, mapping).issues.map((i) => {
      expect(i).toMatchObject({ level: "error", row: 1, wholeFile: true });
      return i.message;
    });

  it("names a project column whose header gives no title, by its column", () => {
    expect(
      stops(
        "Email Address,Rank the projects,Rank the projects [ ],Rank the projects [Tide Clock]\nada@example.edu,1,2,3",
        { ...BRACKETS, columns: { "Email Address": "email" } }
      )
    ).toEqual([
      'Column B, "Rank the projects", is a project column, but its header has no title inside square brackets.',
      'Column C, "Rank the projects [ ]", is a project column, but its header has no title inside square brackets.',
    ]);
    expect(
      stops("Student,Rank Tide Clock\nada@example.edu,1", {
        ...BRACKETS,
        columns: { Student: "email" },
        wide: {
          projectColumns: { by: "prefix", prefix: "Rank" },
          title: { by: "separator", separator: " - " },
        },
      })
    ).toEqual([
      'Column B, "Rank Tide Clock", is a project column, but its header has no title after " - ".',
    ]);
  });

  it("refuses a header that is both a student column and a project column", () => {
    expect(
      stops(FORM, {
        ...BRACKETS,
        columns: {
          "Email Address": "email",
          "Rank the projects [Moon Base]": "name",
        },
      })
    ).toEqual([
      'Column G, "Rank the projects [Moon Base]", is the name column and a project column; choose one.',
    ]);
  });

  it("says when no column is a project column", () => {
    expect(
      stops(FORM, {
        ...BRACKETS,
        wide: {
          projectColumns: { by: "prefix", prefix: "Choice" },
          title: { by: "brackets" },
        },
      })
    ).toEqual(['No column\'s header starts with "Choice".']);
  });

  it("names a picked project column the file lacks", () => {
    expect(
      stops(FORM, {
        ...BRACKETS,
        wide: {
          projectColumns: { by: "headers", headers: ["Rank [Gone]"] },
          title: { by: "brackets" },
        },
      })
    ).toEqual([
      'The file has no "Rank [Gone]" column, which the column mapping reads as a project column.',
    ]);
  });

  it("refuses priority, project, comment or override from a header", () => {
    expect(
      stops(FORM, {
        ...BRACKETS,
        columns: { ...BRACKETS.columns, Timestamp: "comment" },
      })
    ).toEqual([
      "With one column per project, a header fills only email, name or avoid, not comment.",
    ]);
  });

  it("needs only email from a header: the project columns fill the rest", () => {
    expect(unmappedRequired(BRACKETS)).toEqual([]);
    expect(unmappedRequired({ ...BRACKETS, columns: {} })).toEqual(["email"]);
  });

  it("saves and loads as version 2, and version 1 loads as it always did", () => {
    expect(JSON.parse(serializeMapping(BRACKETS))).toEqual(BRACKETS);
    expect(parseMapping(serializeMapping(BRACKETS))).toEqual({
      ok: true,
      mapping: BRACKETS,
    });
    // A version 1 file never had wide reading: anything under that key is
    // ignored, as any unknown key always was.
    expect(parseMapping(JSON.stringify({ ...BRACKETS, version: 1 }))).toEqual({
      ok: true,
      mapping: { version: 1, dataset: "bids", columns: BRACKETS.columns },
    });
  });

  it("refuses wide reading in a file that is not one it reads", () => {
    const refused = (value: unknown) => {
      const parsed = parseMapping(JSON.stringify(value));
      return parsed.ok ? null : parsed.message;
    };
    expect(refused({ ...BRACKETS, dataset: "roster", columns: {} })).toBe(
      "The file is not a column mapping: one column per project is for the bids only."
    );
    expect(
      refused({ ...BRACKETS, columns: { Rank: "priority", Mail: "email" } })
    ).toBe(
      "The file is not a column mapping: with one column per project, a header fills only email, name or avoid, not priority."
    );
    expect(
      refused({
        ...BRACKETS,
        wide: {
          ...BRACKETS.wide,
          projectColumns: { by: "prefix", prefix: " " },
        },
      })
    ).toBe(
      "The file is not a column mapping: the project columns' header start is blank."
    );
    expect(
      refused({
        ...BRACKETS,
        wide: {
          ...BRACKETS.wide,
          projectColumns: { by: "headers", headers: ["Email Address"] },
        },
      })
    ).toBe(
      'The file is not a column mapping: the header "Email Address" is the email column and a project column.'
    );
    expect(
      refused({
        ...BRACKETS,
        wide: { ...BRACKETS.wide, title: { by: "separator", separator: "" } },
      })
    ).toBe("The file is not a column mapping: the title separator is blank.");
  });

  it("is fitted to the bids slot only", () => {
    expect(fitToDataset(BRACKETS, "bids")).toEqual(BRACKETS);
    expect(fitToDataset(BRACKETS, "roster")).toEqual({
      version: 1,
      dataset: "roster",
      columns: { "Email Address": "email", "Your name": "name" },
    });
  });
});

describe("a wide file the column mapping cannot read as it stands (#736)", () => {
  const PICKS: ColumnMapping = {
    version: 2,
    dataset: "bids",
    columns: { Mail: "email" },
    wide: {
      projectColumns: { by: "prefix", prefix: "Pick" },
      title: { by: "brackets" },
    },
  };
  const stopsOf = (text: string, mapping: ColumnMapping) =>
    CUSTOM_MAPPINGS.bids
      .toStandard(text, { projects: [], mapping })
      .issues.map((i) => {
        expect(i).toMatchObject({ level: "error", row: 1, wholeFile: true });
        return i.message;
      });

  it("names two project columns that give the same title, however it is spelled", () => {
    expect(
      stopsOf(
        "Mail,Pick1 [Tide Clock],Pick2 [Robot Arm],Pick3 [ tide  clock: ]\nada@example.edu,1,2,3",
        PICKS
      )
    ).toEqual([
      'Column D, "Pick3 [ tide  clock: ]", gives the same project as column B, "Pick1 [Tide Clock]"; tick or name one of them.',
    ]);
  });

  it("names a header that only an inherited property would answer for", () => {
    expect(
      stopsOf("Mail,Pick [Tide Clock]\nada@example.edu,1", {
        ...PICKS,
        wide: {
          projectColumns: { by: "headers", headers: ["constructor"] },
          title: { by: "brackets" },
        },
      })
    ).toEqual([
      'The file has no "constructor" column, which the column mapping reads as a project column.',
    ]);
    expect(readsAs(PICKS, "toString")).toBe("a project column");
  });

  it("names whose bid each converted row is, apart from the file's own rows", () => {
    // File row 3 is Kim's, who ranked nothing; converted row 3 is Ada's
    // second bid, whose priority the parser refuses.
    const file = [
      "Mail,Pick [Tide Clock],Pick [Robot Arm]",
      "ada@example.edu,1,first",
      "kim@example.edu,,",
    ].join("\n");
    const converted = CUSTOM_MAPPINGS.bids.toStandard(file, {
      projects: [],
      mapping: PICKS,
    });
    expect(converted.issues).toEqual([
      {
        level: "warning",
        row: 3,
        message:
          "The row has no priority in any project column, so it gives no bids.",
      },
    ]);
    const parsed = parseBidsCsv(converted.text, [
      { key: "tide clock", title: "Tide Clock" },
      { key: "robot arm", title: "Robot Arm" },
    ]);
    expect(nameConvertedRows(parsed.issues, converted.text)).toEqual([
      {
        level: "error",
        row: 3,
        message:
          "priority must be a whole number, 1 or more. That row is ada@example.edu's bid for Robot Arm.",
      },
    ]);
  });
});

describe("a column mapping file's version", () => {
  const refused = (version: unknown) => {
    const parsed = parseMapping(
      JSON.stringify({ ...MAPPING, version: version ?? undefined })
    );
    return parsed.ok ? null : parsed.message;
  };

  it("says what it is when it is not one this page reads", () => {
    expect(refused("2")).toBe(
      'The column mapping\'s version is "2", which is not a number, and this page reads version 2 and earlier.'
    );
    expect(refused(null)).toBe(
      "The column mapping has no version, and this page reads version 2 and earlier."
    );
    expect(refused(0)).toBe(
      "The column mapping is version 0, and this page reads version 2 and earlier."
    );
  });
});

describe("the editor's wide reading (#736)", () => {
  const columns = {
    "Email Address": "email",
    Rank: "priority",
    "Your name": "name",
  };

  it("starts off, with Qualtrics' separator, or from a stored column mapping", () => {
    expect(wideDraft(undefined)).toEqual({
      on: false,
      by: "prefix",
      prefix: "",
      headers: [],
      titleBy: "separator",
      separator: " - ",
    });
    expect(
      wideDraft({
        projectColumns: { by: "headers", headers: ["Rank [A]"] },
        title: { by: "brackets" },
      })
    ).toEqual({
      on: true,
      by: "headers",
      prefix: "",
      headers: ["Rank [A]"],
      titleBy: "brackets",
      separator: " - ",
    });
  });

  it("stores only the student columns and the choice in use, at version 2", () => {
    const draft = {
      ...wideDraft(undefined),
      on: true,
      prefix: "Rank the projects",
      headers: ["Rank [A]"],
      titleBy: "brackets" as const,
    };
    expect(editedMapping("bids", columns, draft)).toEqual({
      version: 2,
      dataset: "bids",
      columns: { "Email Address": "email", "Your name": "name" },
      wide: {
        projectColumns: { by: "prefix", prefix: "Rank the projects" },
        title: { by: "brackets" },
      },
    });
    // Off, the columns come back as they were, and nothing is wide.
    expect(editedMapping("bids", columns, { ...draft, on: false })).toEqual({
      version: 1,
      dataset: "bids",
      columns,
    });
    // Only the bids read wide.
    expect(editedMapping("roster", columns, draft).wide).toBeUndefined();
  });

  it("says what stops Apply and how to fix it", () => {
    expect(
      applyStatus("bids", [], [], [], ["The title separator is blank."])
    ).toBe(
      "The title separator is blank. Change the column mapping to apply it."
    );
  });
});

describe("fitting a column mapping to a slot", () => {
  it("names what it leaves out, and the editor's status says so", () => {
    const bids: ColumnMapping = {
      version: 1,
      dataset: "bids",
      columns: { Mail: "email", Rank: "priority", Other: "email" },
    };
    const dropped = droppedColumns(bids, "roster");
    expect(dropped).toEqual(['"Rank" (priority)', '"Other" (email)']);
    expect(applyStatus("roster", [], [], dropped)).toBe(
      '"Rank" (priority), "Other" (email) are not in the roster format, so the column mapping leaves them out. Every required column is mapped.'
    );
    expect(droppedColumns(MAPPING, "roster")).toEqual([]);
  });

  it("keeps only its dataset's columns, the first header for each, stamped with the slot", () => {
    expect(
      fitToDataset(
        {
          version: 1,
          dataset: "bids",
          columns: { Mail: "email", Rank: "priority", Other: "email" },
        },
        "roster"
      )
    ).toEqual({ version: 1, dataset: "roster", columns: { Mail: "email" } });
  });

  it("keeps the headers a file has, spelled as the file spells them", () => {
    expect(presentIn(MAPPING, ["student email", "Team"]).columns).toEqual({
      "student email": "email",
      Team: "project",
    });
  });
});

describe("the headers a mapping offers", () => {
  it("are spelled as the file spells them, without blanks, repeats or a BOM", () => {
    expect(
      fileHeaders("﻿Student Email, Full Name ,,student email\nx,y,z,w")
    ).toEqual(["Student Email", "Full Name"]);
  });

  it("are read after blank lines before the header, as the rows are", () => {
    expect(fileHeaders("\r\n \nStudent Email,Team\nx,y")).toEqual([
      "Student Email",
      "Team",
    ]);
  });

  it("are suggested for a standard column whose name they match, ignoring case", () => {
    expect(suggestMapping("roster", ["EMAIL", "Full Name", "Project"])).toEqual(
      {
        version: 1,
        dataset: "roster",
        columns: { EMAIL: "email", Project: "project" },
      }
    );
  });
});

describe("a mapping file", () => {
  it("loads back as the mapping it was saved from, and reads the file the same", () => {
    const loaded = parseMapping(serializeMapping(MAPPING));
    expect(loaded).toEqual({ ok: true, mapping: MAPPING });
    if (loaded.ok) {
      expect(read(FILE, loaded.mapping)).toEqual(read(FILE, MAPPING));
    }
  });

  it("says why it cannot be read", () => {
    const refused = (value: unknown) => {
      const parsed = parseMapping(
        typeof value === "string" ? value : JSON.stringify(value)
      );
      return parsed.ok ? null : parsed.message;
    };
    expect(refused("{")).toBe("The file is not JSON.");
    expect(refused({ ...MAPPING, version: 3 })).toBe(
      "The column mapping is version 3, and this page reads version 2 and earlier."
    );
    expect(refused({ ...MAPPING, columns: { Team: "team" } })).toBe(
      "The file is not a column mapping: team is not a column of the roster format."
    );
    expect(
      refused({ ...MAPPING, columns: { Mail: "email", "E-mail": "email" } })
    ).toBe(
      "The file is not a column mapping: more than one header fills email."
    );
    expect(
      refused({ ...MAPPING, columns: { Mail: "email", " mail": "name" } })
    ).toBe(
      'The file is not a column mapping: the header " mail" is listed twice.'
    );
  });

  it("is read through the plugin registry's guard like any plugin", () => {
    expect(
      toStandard(CUSTOM_MAPPINGS.roster, FILE, {
        projects: [],
        mapping: MAPPING,
      }).issues
    ).toEqual([]);
  });
});
