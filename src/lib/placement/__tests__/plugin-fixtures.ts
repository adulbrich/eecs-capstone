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
