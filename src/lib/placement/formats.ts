import { toCsv } from "#/lib/csv";

/**
 * What each import expects, shown beside its upload button and written out
 * as a template, so the page and the parser describe one format. The
 * example rows are invented.
 */

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
  ],
  templateRows: [
    { title: "Tide Clock", max_teams: "2", min_students: "", max_students: "" },
    { title: "Robot Arm", max_teams: "", min_students: "2", max_students: "3" },
  ],
};

export const BIDS_FORMAT: CsvFormat = {
  filename: "placement-bids-template",
  note: "The bidding survey's Qualtrics export also works as it comes: it is recognized by its three header rows and converted to this format on upload.",
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

export function formatTemplate(format: CsvFormat): string {
  return toCsv(
    format.columns.map((c) => ({
      header: c.name,
      value: (row: Record<string, string>) => row[c.name] ?? "",
    })),
    format.templateRows
  );
}

export const ROSTER_FORMAT: CsvFormat = {
  filename: "placement-roster-template",
  note: "Canvas's roster and groups export also works as it comes: login_id is read as the email and group_name as the project. Or paste the emails in the box instead: one per line, or separated by commas, semicolons or spaces. Pre-approvals come only from a file.",
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
