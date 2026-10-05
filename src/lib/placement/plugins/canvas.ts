import { toCsv } from "#/lib/csv";
import {
  cell,
  type ImportIssue,
  missingColumns,
  parseRows,
  type Row,
} from "#/lib/placement/csv";
import { CSV_EXTENSION } from "#/lib/placement/download";
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

const REQUIRED = PLACEMENT_FORMAT.columns
  .filter((c) => c.required)
  .map((c) => c.name);

/** Canvas's columns, in the order the file writes them. */
const GROUP_COLUMNS = ["name", "login_id", "group_name"] as const;

type GroupRow = Record<(typeof GROUP_COLUMNS)[number], string>;

/** A placed student, as the standard placement's row has them. */
interface Placed {
  email: string;
  name: string;
  project: string;
  /** The row in the standard CSV, header as row 1. */
  row: number;
  team: string;
}

/** Every placed student, each row read once. The unplaced have no project. */
function readPlaced(rows: readonly Row[]): Placed[] {
  return rows.flatMap((raw, i): Placed[] => {
    const project = cell(raw, "project");
    return project === ""
      ? []
      : [
          {
            email: cell(raw, "email"),
            name: cell(raw, "name"),
            project,
            row: i + 2,
            team: cell(raw, "team"),
          },
        ];
  });
}

/** Each project's team numbers, leaving out a row that names none. */
function teamsByProject(placed: readonly Placed[]): Map<string, Set<string>> {
  const teams = new Map<string, Set<string>>();
  for (const { project, team } of placed) {
    if (team !== "") {
      const numbers = teams.get(project) ?? new Set<string>();
      numbers.add(team);
      teams.set(project, numbers);
    }
  }
  return teams;
}

/**
 * The group a placed student joins, and the project or team it stands for,
 * or the problem that leaves their row out.
 */
function groupOf(
  p: Placed,
  teams: ReadonlyMap<string, ReadonlySet<string>>
): { group: string; source: string } | ImportIssue {
  const several = (teams.get(p.project)?.size ?? 0) > 1;
  if (p.email === "") {
    return {
      level: "error",
      row: p.row,
      message: "The row has no email, which Canvas needs as the login.",
    };
  }
  if (!several) {
    return { group: p.project, source: p.project };
  }
  if (p.team === "") {
    return {
      level: "error",
      row: p.row,
      message: `${p.project} has more than one team, and the row names none.`,
    };
  }
  return {
    group: `${p.project} (Team ${p.team})`,
    source: `team ${p.team} of ${p.project}`,
  };
}

/**
 * The file's rows, and what naming the groups found: a row left out, or a
 * group name two projects or teams share, which Canvas would make one group.
 */
function groupRows(placed: readonly Placed[]): {
  issues: ImportIssue[];
  kept: GroupRow[];
} {
  const teams = teamsByProject(placed);
  const issues: ImportIssue[] = [];
  const kept: GroupRow[] = [];
  // Where each group name came from first, and the names already warned of.
  const sources = new Map<string, string>();
  const merged = new Set<string>();
  for (const p of placed) {
    const named = groupOf(p, teams);
    if ("level" in named) {
      issues.push(named);
      continue;
    }
    const { group, source } = named;
    const first = sources.get(group);
    if (first === undefined) {
      sources.set(group, source);
    } else if (first !== source && !merged.has(group)) {
      merged.add(group);
      issues.push({
        level: "warning",
        row: p.row,
        message: `${first} and ${source} both become the group "${group}", which Canvas would fill with the students of both. Rename one of the projects to keep them apart.`,
      });
    }
    kept.push({ name: p.name, login_id: p.email, group_name: group });
  }
  return { issues, kept };
}

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
    "A file to import into a Canvas group set. Canvas matches each student by their login, which is their email here, and creates the groups in the group set you import into: one per project, or one per team when a project has more than one. Unplaced students are left out, and stay in no group. The file keeps a leading apostrophe on a title starting with =, +, - or @, which stops a spreadsheet reading it as a formula, and Canvas may show it in the group name. A run that changes how many teams a project has also changes its group names, so import into a new group set rather than over an old one.",
  // Canvas ignores `name` on import, so it is not required.
  requiredColumns: GROUP_COLUMNS.filter((c) => c !== "name"),
  fromStandard: (text, { filename }) => {
    const { fields, issues: parseIssues, rows } = parseRows(text);
    const issues = [...parseIssues, ...missingColumns(fields, REQUIRED)];
    const grouped = issues.some((i) => i.wholeFile)
      ? { issues: [], kept: [] }
      : groupRows(readPlaced(rows));
    return {
      filename: filename.replace(CSV_EXTENSION, " (Canvas groups).csv"),
      issues: [...issues, ...grouped.issues],
      text: toCsv(
        GROUP_COLUMNS.map((header) => ({
          header,
          value: (r: GroupRow) => r[header],
        })),
        grouped.kept
      ),
    };
  },
};
