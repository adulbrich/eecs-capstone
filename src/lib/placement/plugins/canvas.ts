import { toCsv } from "#/lib/csv";
import {
  cell,
  type ImportIssue,
  missingColumns,
  parseRows,
} from "#/lib/placement/csv";
import { PLACEMENT_FORMAT } from "#/lib/placement/formats";
import type { ExportPlugin, FilePlugin } from "#/lib/placement/plugins/types";
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

const CSV_EXTENSION = /(\.csv)?$/i;

const REQUIRED = PLACEMENT_FORMAT.columns
  .filter((c) => c.required)
  .map((c) => c.name);

type GroupRow = Record<"name" | "login_id" | "group_name", string>;

/**
 * The placement as a Canvas group set import (#734), in the shape of
 * https://canvas.instructure.com/doc/api/file.group_category_csv.html:
 * `login_id` names the student, as the roster plugin reads it, and Canvas
 * creates any group named in `group_name` that the group set lacks. `name`
 * is ignored by Canvas and kept so the file reads by eye. A project with one
 * team is a group under its title; with more, each team is "<title> (Team
 * N)", numbered as the board numbers it. Unplaced students are left out.
 */
export const canvasGroups: ExportPlugin = {
  id: "canvas-groups",
  label: "Canvas groups",
  dataset: "placement",
  description:
    "A file to import into a Canvas group set. Canvas matches each student by their login, which is their email here, and creates the groups in the group set you import into: one per project, or one per team when a project has more than one. Unplaced students are left out, and stay in no group.",
  requiredColumns: ["login_id", "group_name"],
  fromStandard: (text, { filename }) => {
    const { fields, issues: parseIssues, rows } = parseRows(text);
    const issues: ImportIssue[] = [
      ...parseIssues,
      ...missingColumns(fields, REQUIRED),
    ];
    const kept: GroupRow[] = [];
    if (!issues.some((i) => i.wholeFile)) {
      const teams = new Map<string, Set<string>>();
      for (const raw of rows) {
        const project = cell(raw, "project");
        const team = cell(raw, "team");
        if (project !== "" && team !== "") {
          teams.set(project, (teams.get(project) ?? new Set()).add(team));
        }
      }
      rows.forEach((raw, i) => {
        const row = i + 2;
        const project = cell(raw, "project");
        if (project === "") {
          return;
        }
        const email = cell(raw, "email");
        const team = cell(raw, "team");
        const several = (teams.get(project)?.size ?? 0) > 1;
        if (email === "") {
          issues.push({
            level: "error",
            row,
            message: "The row has no email, which Canvas needs as the login.",
          });
        } else if (several && team === "") {
          issues.push({
            level: "error",
            row,
            message: `${project} has more than one team, and the row names none.`,
          });
        } else {
          kept.push({
            name: cell(raw, "name"),
            login_id: email,
            group_name: several ? `${project} (Team ${team})` : project,
          });
        }
      });
    }
    return {
      filename: filename.replace(CSV_EXTENSION, " (Canvas groups).csv"),
      issues,
      text: toCsv(
        (["name", "login_id", "group_name"] as const).map((header) => ({
          header,
          value: (r: GroupRow) => r[header],
        })),
        kept
      ),
    };
  },
};
