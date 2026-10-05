import type { PluginContext } from "#/lib/placement/plugins/types";
import type { WorkspaceProject } from "#/lib/placement/types";

/**
 * One source per registered plugin, by plugin id, for the contract test in
 * `plugins.contract.test.ts`: what an import plugin reads, or the standard
 * CSV an export plugin reads. Invented names and `example.edu` addresses
 * only. Kept out of the plugin modules so test data never reaches the page's
 * bundle.
 */

export const FIXTURE_PROJECTS: WorkspaceProject[] = [
  { key: "tide clock", title: "Tide Clock", weightMultiplier: 1 },
  { key: "robot arm", title: "Robot Arm", weightMultiplier: 1 },
];

const quote = (cells: string[]) =>
  cells.map((c) => `"${c.replaceAll('"', '""')}"`).join(",");

const QUALTRICS_IDS = [
  "status",
  "finished",
  "recordedDate",
  "recipientLastName",
  "recipientFirstName",
  "recipientEmail",
  "QID30_1",
  "QID30_2",
];

export const PLUGIN_FIXTURES: Record<string, string> = {
  "canvas-roster": [
    "name,canvas_user_id,user_id,login_id,sections,group_name,canvas_group_id,group_id",
    "Ada Park,101,9001,ada@example.edu,CS 461,Tide Clock,55,7",
    "Kim Lee,102,9002,kim@example.edu,CS 461,,,",
  ].join("\n"),
  "qualtrics-bids": [
    quote(QUALTRICS_IDS.map((_, i) => `Q${i}`)),
    quote([
      "Response Type",
      "Finished",
      "Recorded Date",
      "Recipient Last Name",
      "Recipient First Name",
      "Recipient Email",
      "Rank your top choices. - Tide Clock",
      "Rank your top choices. - Robot Arm",
    ]),
    quote(QUALTRICS_IDS.map((id) => JSON.stringify({ ImportId: id }))),
    quote([
      "IP Address",
      "True",
      "2026-09-28 10:00:00",
      "Park",
      "Ada",
      "ada@example.edu",
      "2",
      "1",
    ]),
  ].join("\n"),
  "paste-roster":
    "Ada Park <ada@example.edu>\nkim@example.edu, lou@example.edu",
  "paste-titles": "Tide Clock\n\nRobot Arm",
  // A standard placement: Tide Clock with two teams, Robot Arm with one,
  // and an unplaced student.
  "canvas-groups": [
    "email,name,project,team,priority,comment,avoid",
    "ada@example.edu,Ada Park,Tide Clock,1,1,,",
    "kim@example.edu,Kim Lee,Tide Clock,2,pre-approved,,",
    "lou@example.edu,Lou Ma,Robot Arm,1,not in the survey,,",
    "cy@example.edu,Cy Moss,,,,,",
  ].join("\r\n"),
};

/** A file nothing detects, and what staff chose to read it with. */
export interface ChosenFixture {
  context: Omit<PluginContext, "projects">;
  text: string;
}

/**
 * For a plugin staff choose rather than one that detects its file, by id:
 * one fixture per way staff can choose to read a file. Custom mapping's
 * headers are spelled and ordered unlike the standard format's, and leave
 * an optional column unmapped; its bids are read one row per bid, and wide,
 * one column per project (#736).
 */
export const CHOSEN_FIXTURES: Record<string, ChosenFixture[]> = {
  "custom-mapping-projects": [
    {
      text: [
        "Sponsor,Project Name,Teams",
        "Jane Doe,Tide Clock,2",
        "Ada Park,Robot Arm,",
      ].join("\n"),
      context: {
        mapping: {
          version: 1,
          dataset: "projects",
          columns: {
            "Project Name": "title",
            Teams: "max_teams",
            Sponsor: "proposer_name",
          },
        },
      },
    },
  ],
  "custom-mapping-roster": [
    {
      text: [
        "Student Email,Full Name,Team",
        "ada@example.edu,Ada Park,Tide Clock",
        "kim@example.edu,Kim Lee,",
      ].join("\n"),
      context: {
        mapping: {
          version: 1,
          dataset: "roster",
          columns: {
            "Student Email": "email",
            "Full Name": "name",
            Team: "project",
          },
        },
      },
    },
  ],
  "custom-mapping-bids": [
    {
      text: [
        "Choice,Student,Rank,Why",
        "Tide Clock,ada@example.edu,1,I built a tide gauge.",
        "Robot Arm,ada@example.edu,2,",
      ].join("\n"),
      context: {
        mapping: {
          version: 1,
          dataset: "bids",
          columns: {
            Student: "email",
            Rank: "priority",
            Choice: "project",
            Why: "comment",
          },
        },
      },
    },
    {
      // A Google Forms grid: a blank cell is no bid.
      text: [
        "Timestamp,Email Address,Name,Rank the projects [Tide Clock],Rank the projects [Robot Arm]",
        "2026-09-28 10:00,ada@example.edu,Ada Park,2,1",
        "2026-09-28 10:05,kim@example.edu,Kim Lee,1,",
      ].join("\n"),
      context: {
        mapping: {
          version: 2,
          dataset: "bids",
          columns: { "Email Address": "email", Name: "name" },
          wide: {
            projectColumns: { by: "prefix", prefix: "Rank the projects" },
            title: { by: "brackets" },
          },
        },
      },
    },
  ],
};
