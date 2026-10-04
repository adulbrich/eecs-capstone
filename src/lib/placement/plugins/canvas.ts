import { cell, parseRows } from "#/lib/placement/csv";
import type { FilePlugin } from "#/lib/placement/plugins/types";
import { readRosterCsv, rosterCsv } from "#/lib/placement/roster";

/**
 * Canvas's roster and groups export (#674): `login_id` is the email and
 * `group_name` is the team, read as the project the student is pre-approved
 * for. `login_id` is read as it comes, with no domain added, so the plugin
 * works wherever Canvas logins are email addresses.
 */
export const canvasRoster: FilePlugin = {
  id: "canvas-roster",
  label: "Canvas roster export",
  dataset: "roster",
  input: "file",
  description:
    "Read as a Canvas roster and groups export: login_id is the email, and each student's group_name is the project they are pre-approved for. A group named like a project on the Projects tab joins it; any other group becomes a project of its own holding just that group. A student in no group is not pre-approved. A student listed twice keeps their first group, and the problems list names any other it ignored. Canvas's Test Student is left out.",
  // A file with an email column is the roster's own format, which is tried
  // first, even when it also has login_id.
  detect: (text) => parseRows(text).fields.includes("login_id"),
  toStandard: (text) => {
    const { entries, issues } = readRosterCsv(text, {
      email: "login_id",
      name: "name",
      project: "group_name",
      // Canvas adds a Test Student to every course, with no login_id.
      skipRow: (raw) =>
        cell(raw, "name").toLowerCase() === "test student"
          ? "Canvas's Test Student has no login_id, and is left out."
          : undefined,
    });
    return { text: rosterCsv(entries), issues };
  },
};
