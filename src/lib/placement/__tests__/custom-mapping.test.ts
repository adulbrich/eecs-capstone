import { describe, expect, it } from "vitest";
import { toStandard } from "#/lib/placement/plugins";
import {
  type ColumnMapping,
  CUSTOM_MAPPINGS,
  fileHeaders,
  fitToDataset,
  parseMapping,
  presentIn,
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
    expect(read(`\n\n${FILE}`, MAPPING)).toEqual(read(FILE, MAPPING));
    expect(read(`\n${FILE}`, MAPPING).text).toContain("ada@example.edu");
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

describe("fitting a column mapping to a slot", () => {
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
    expect(refused({ ...MAPPING, version: 2 })).toBe(
      "The column mapping is version 2, and this page reads version 1."
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
