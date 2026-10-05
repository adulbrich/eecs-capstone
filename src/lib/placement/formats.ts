import { toCsv } from "#/lib/csv";

/**
 * What each import expects, shown beside its upload button and written out
 * as a template, so the page and the parser describe one format. The
 * example rows are invented.
 */

/** A file name's ".csv", if it has one, for naming what is made from it. */
export const CSV_EXTENSION = /(\.csv)?$/i;

export interface FormatColumn {
  example: string;
  meaning: string;
  name: string;
  required: boolean;
}

export interface CsvFormat {
  columns: FormatColumn[];
  filename: string;
  /** Another shape the upload accepts, said under the column table. */
  note?: string;
  templateRows: Record<string, string>[];
}

export const PROJECTS_FORMAT: CsvFormat = {
  filename: "placement-projects-template",
  columns: [
    {
      name: "title",
      required: true,
      meaning:
        "The project's name, spelled as the bids file spells it. Case and extra spaces are ignored.",
      example: "Tide Clock",
    },
    {
      name: "max_teams",
      required: false,
      meaning:
        "How many teams the project may take. Blank uses the page default; 0 leaves it out.",
      example: "2",
    },
    {
      name: "min_students",
      required: false,
      meaning: "Fewest students on a team. Blank uses the page default.",
      example: "3",
    },
    {
      name: "max_students",
      required: false,
      meaning: "Most students on a team. Blank uses the page default.",
      example: "4",
    },
    {
      name: "proposer_name",
      required: false,
      meaning: "Who proposed the project, shown in the Contact column.",
      example: "Jane Doe",
    },
    {
      name: "proposer_email",
      required: false,
      meaning: "The proposer's email address.",
      example: "jane.doe@example.com",
    },
    {
      name: "mentor_name",
      required: false,
      meaning:
        "The project's mentor, who is the contact for a student-proposed project.",
      example: "Pat Lee",
    },
    {
      name: "mentor_email",
      required: false,
      meaning: "The mentor's email address.",
      example: "pat.lee@example.edu",
    },
    {
      name: "student_proposed",
      required: false,
      meaning:
        "true when students proposed the project, as yes or 1 also say. Blank means false.",
      example: "true",
    },
  ],
  templateRows: [
    {
      title: "Tide Clock",
      max_teams: "2",
      min_students: "",
      max_students: "",
      proposer_name: "Jane Doe",
      proposer_email: "jane.doe@example.com",
      mentor_name: "",
      mentor_email: "",
      student_proposed: "",
    },
    {
      title: "Robot Arm",
      max_teams: "",
      min_students: "2",
      max_students: "3",
      proposer_name: "Ada Park",
      proposer_email: "ada.park@example.edu",
      mentor_name: "Pat Lee",
      mentor_email: "pat.lee@example.edu",
      student_proposed: "true",
    },
  ],
};

export const BIDS_FORMAT: CsvFormat = {
  filename: "placement-bids-template",
  note: "The bidding survey's Qualtrics export also works as it comes: it is recognized by its header rows and converted to this format. Once a file is up, Read as changes how it is read.",
  columns: [
    {
      name: "email",
      required: true,
      meaning: "The student's email. Every row for one student repeats it.",
      example: "ada@example.edu",
    },
    {
      name: "name",
      required: false,
      meaning: "The student's name, for display.",
      example: "Ada Park",
    },
    {
      name: "priority",
      required: true,
      meaning:
        "1 for the student's first choice, 2 for the second, and so on. May be blank on a pinned row.",
      example: "1",
    },
    {
      name: "project",
      required: true,
      meaning: "A project title from the Projects tab.",
      example: "Tide Clock",
    },
    {
      name: "comment",
      required: false,
      meaning: "What the student wrote about this project.",
      example: "I built a tide gauge last summer.",
    },
    {
      name: "override",
      required: false,
      meaning:
        "true pins the student to this row's project on every run. At most one per student.",
      example: "false",
    },
    {
      name: "avoid",
      required: false,
      meaning:
        "Who the student would prefer not to work with. Shown to staff; the solver ignores it.",
      example: "",
    },
  ],
  templateRows: [
    {
      email: "ada@example.edu",
      name: "Ada Park",
      priority: "1",
      project: "Tide Clock",
      comment: "I built a tide gauge last summer.",
      override: "",
      avoid: "",
    },
    {
      email: "ada@example.edu",
      name: "Ada Park",
      priority: "2",
      project: "Robot Arm",
      comment: "",
      override: "",
      avoid: "",
    },
  ],
};

/**
 * Rows written in a format's own columns and order, with a blank for any
 * column a row lacks: how a template is made, and how a plugin writes what
 * it read.
 */
export function writeFormat(
  format: CsvFormat,
  rows: Record<string, string>[]
): string {
  return toCsv(
    format.columns.map((c) => ({
      header: c.name,
      value: (row: Record<string, string>) => row[c.name] ?? "",
    })),
    rows
  );
}

export const formatTemplate = (format: CsvFormat): string =>
  writeFormat(format, format.templateRows);

export const ROSTER_FORMAT: CsvFormat = {
  filename: "placement-roster-template",
  note: "Canvas's roster and groups export also works as it comes: login_id is read as the email and group_name as the project. A file with an email column is read as the format above, even if it also has login_id; once a file is up, Read as changes how it is read. Or paste the emails in the box instead: one per line, or separated by commas, semicolons or spaces. Pre-approvals come only from a file.",
  columns: [
    {
      name: "email",
      required: true,
      meaning:
        "The student's email, as the survey has it. One row per student.",
      example: "ada@example.edu",
    },
    {
      name: "name",
      required: false,
      meaning:
        "The student's name, for a student who did not answer the survey.",
      example: "Ada Park",
    },
    {
      name: "project",
      required: false,
      meaning:
        "A project the student is pre-approved for: they are placed there on every run. A title not on the Projects tab adds that project, holding just its pre-approved students.",
      example: "Tide Clock",
    },
  ],
  templateRows: [
    { email: "ada@example.edu", name: "Ada Park", project: "" },
    { email: "kim@example.edu", name: "Kim Lee", project: "Tide Clock" },
  ],
};

/**
 * What "Download placement" writes (`placementCsv`), and what an export
 * plugin reads (#734). Placement only ever writes it: no import reads it.
 */
export const PLACEMENT_FORMAT: CsvFormat = {
  filename: "placement-template",
  columns: [
    {
      name: "email",
      required: true,
      meaning: "The student's email. One row per student.",
      example: "ada@example.edu",
    },
    {
      name: "name",
      required: false,
      meaning: "The student's name.",
      example: "Ada Park",
    },
    {
      name: "project",
      required: true,
      meaning:
        "The title of the project the student is placed on. Blank for an unplaced student.",
      example: "Tide Clock",
    },
    {
      name: "team",
      required: true,
      meaning:
        "The student's team on that project, numbered from 1 as the board numbers it. Blank for an unplaced student.",
      example: "1",
    },
    {
      name: "priority",
      required: false,
      meaning:
        "The priority the student gave that project; pre-approved for a roster pre-approval; not in the survey for a roster student without bids; blank for a placement outside their bids.",
      example: "1",
    },
    {
      name: "comment",
      required: false,
      meaning: "What the student wrote about that project.",
      example: "I built a tide gauge last summer.",
    },
    {
      name: "avoid",
      required: false,
      meaning: "Who the student would prefer not to work with.",
      example: "",
    },
  ],
  templateRows: [
    {
      email: "ada@example.edu",
      name: "Ada Park",
      project: "Tide Clock",
      team: "1",
      priority: "1",
      comment: "I built a tide gauge last summer.",
      avoid: "",
    },
    {
      email: "kim@example.edu",
      name: "Kim Lee",
      project: "",
      team: "",
      priority: "",
      comment: "",
      avoid: "",
    },
  ],
};

/** The one standard format of each dataset, which every plugin writes. */
export const STANDARD_FORMATS = {
  projects: PROJECTS_FORMAT,
  roster: ROSTER_FORMAT,
  bids: BIDS_FORMAT,
} as const satisfies Record<string, CsvFormat>;

/** A dataset staff upload or paste, which import plugins convert into. */
export type PlacementDataset = keyof typeof STANDARD_FORMATS;

/**
 * What placement writes, which export plugins convert out of (#734): the
 * placement, and the bids again with their pins.
 */
export const EXPORT_FORMATS = {
  placement: PLACEMENT_FORMAT,
  bids: BIDS_FORMAT,
} as const satisfies Record<string, CsvFormat>;

export type ExportDataset = keyof typeof EXPORT_FORMATS;
