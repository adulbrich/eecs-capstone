import {
  cell,
  type ImportIssue,
  missingColumns,
  normalizeTitle,
  parseRows,
  pastedLines,
  projectKeysByTitle,
} from "#/lib/placement/csv";
import {
  type ProjectCandidate,
  rankProjects,
  suggestProject,
} from "#/lib/placement/match";
import type { PlacementStudent, WorkspaceProject } from "#/lib/placement/types";

/**
 * The class roster (#665): every student in the class, so the ones who never
 * answered the bidding survey are placed too. It comes as a CSV or as pasted
 * emails, and merges with the bids on email. Browser only (ADR-0056).
 */

export interface RosterEntry {
  /** Lowercased and trimmed; the key the merge uses. */
  email: string;
  name: string;
  /** The title of the project the student is pre-approved for (#670). */
  project?: string;
}

export interface ParsedRoster {
  entries: RosterEntry[];
  /** How a CSV was read; a pasted list is always "roster". */
  format: RosterFormat;
  issues: ImportIssue[];
}

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const NAMED = /^(.*)<([^<>]+)>$/;
const WHITESPACE = /\s+/;
const QUOTES = /^["']|["']$/g;

export const isEmail = (text: string) => EMAIL.test(text);

/**
 * A pasted line cut at each comma or semicolon outside double quotes and
 * angle brackets, so `"Park, Ada" <ada@example.edu>` stays one item.
 */
function splitItems(line: string): string[] {
  const items: string[] = [];
  let current = "";
  let quoted = false;
  let bracketed = false;
  for (const char of line) {
    if (char === '"') {
      quoted = !quoted;
    } else if (char === "<") {
      bracketed = true;
    } else if (char === ">") {
      bracketed = false;
    }
    if ((char === "," || char === ";") && !quoted && !bracketed) {
      items.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  items.push(current);
  return items;
}

/** Adds an entry, or a warning when the email is already on the roster. */
function collect(
  entries: RosterEntry[],
  seen: Map<string, number>,
  issues: ImportIssue[],
  row: number,
  entry: RosterEntry,
  unit: "line" | "row"
) {
  const earlier = seen.get(entry.email);
  if (earlier !== undefined) {
    issues.push({
      level: "warning",
      row,
      message: `${entry.email} is already on ${unit} ${earlier}; keeping the first.`,
    });
    return;
  }
  seen.set(entry.email, row);
  entries.push(entry);
}

/**
 * Which column holds what. The roster's own format, or Canvas's roster and
 * groups export (#674), whose `login_id` is the email and whose `group_name`
 * is the team, read as the pre-approved project.
 */
interface RosterColumns {
  email: string;
  format: RosterFormat;
  project: string;
}

export type RosterFormat = "canvas" | "roster";

const ROSTER_COLUMNS: RosterColumns = {
  format: "roster",
  email: "email",
  project: "project",
};
const CANVAS_COLUMNS: RosterColumns = {
  format: "canvas",
  email: "login_id",
  project: "group_name",
};

/** A Canvas export has `login_id` and no `email`; `email` wins if both. */
const columnsFor = (fields: readonly string[]): RosterColumns =>
  fields.includes("login_id") && !fields.includes("email")
    ? CANVAS_COLUMNS
    : ROSTER_COLUMNS;

type RawRow = Parameters<typeof cell>[0];

const projectCell = (raw: RawRow, column: string) => {
  const project = cell(raw, column);
  return project === "" ? {} : { project };
};

/** A project cell that normalizes to nothing: "..." pre-approves nobody. */
const unreadableProject = (raw: RawRow, column: string) => {
  const project = cell(raw, column);
  return project !== "" && normalizeTitle(project) === "" ? project : null;
};

/**
 * `email, name, project`, one row per student; only `email` is required.
 * `project` pre-approves the student for that project. A Canvas roster and
 * groups export reads as it comes: see `RosterColumns`.
 */
export function parseRosterCsv(text: string): ParsedRoster {
  const { fields, issues, rows } = parseRows(text);
  const columns = columnsFor(fields);
  const missing =
    fields.length === 0 && issues.length > 0
      ? []
      : missingColumns(fields, [columns.email]);
  if (missing.length > 0) {
    return {
      entries: [],
      issues: [...issues, ...missing],
      format: columns.format,
    };
  }
  const entries: RosterEntry[] = [];
  const seen = new Map<string, number>();
  const failedRows = new Set(issues.map((i) => i.row));
  rows.forEach((raw, index) => {
    const row = index + 2;
    if (failedRows.has(row)) {
      return;
    }
    const email = cell(raw, columns.email).toLowerCase();
    if (!isEmail(email)) {
      issues.push({
        level: "error",
        row,
        message:
          email === ""
            ? `The row has no ${columns.email}.`
            : `"${email}" is not an email.`,
      });
      return;
    }
    const unreadable = unreadableProject(raw, columns.project);
    if (unreadable !== null) {
      issues.push({
        level: "warning",
        row,
        message: `"${unreadable}" names no project, so ${email} is not pre-approved.`,
      });
    }
    collect(
      entries,
      seen,
      issues,
      row,
      { email, name: cell(raw, "name"), ...projectCell(raw, columns.project) },
      "row"
    );
  });
  return {
    entries,
    issues: issues.sort((a, b) => a.row - b.row),
    format: columns.format,
  };
}

/**
 * One item of a pasted line: `Name <email>`, bare emails separated by
 * spaces, or one email with the words around it as its name, which is what
 * two spreadsheet columns pasted together look like.
 */
function readItem(item: string): RosterEntry[] | { error: string } {
  const named = NAMED.exec(item);
  if (named) {
    const email = named[2].trim().toLowerCase();
    return isEmail(email)
      ? [{ email, name: named[1].trim().replace(QUOTES, "").trim() }]
      : { error: `"${named[2].trim()}" is not an email.` };
  }
  const tokens = item.split(WHITESPACE).filter((t) => t !== "");
  const emails = tokens.filter(isEmail);
  const words = tokens.filter((t) => !isEmail(t));
  if (emails.length === 0) {
    return { error: `"${item}" is not an email.` };
  }
  if (emails.length === 1) {
    return [{ email: emails[0].toLowerCase(), name: words.join(" ") }];
  }
  if (words.length > 0) {
    return { error: `"${words[0]}" is not an email.` };
  }
  return emails.map((email) => ({ email: email.toLowerCase(), name: "" }));
}

/**
 * Pasted emails: one per line, or several on a line separated by commas,
 * semicolons or spaces. An issue's `row` is the line number.
 */
export function parseRosterList(text: string): ParsedRoster {
  const entries: RosterEntry[] = [];
  const issues: ImportIssue[] = [];
  const seen = new Map<string, number>();
  for (const { line, text: content } of pastedLines(text)) {
    for (const raw of splitItems(content)) {
      const item = raw.trim();
      if (item === "") {
        continue;
      }
      const read = readItem(item);
      if ("error" in read) {
        issues.push({ level: "error", row: line, message: read.error });
        continue;
      }
      for (const entry of read) {
        collect(entries, seen, issues, line, entry, "line");
      }
    }
  }
  return { entries, issues, format: "roster" };
}

/** What the roster's pre-approvals come to against the project list. */
export interface RosterAssignments {
  /**
   * Projects the roster names that the list lacks, one team of exactly
   * their pre-approved students, so nobody else is placed there.
   */
  added: WorkspaceProject[];
  /** An added project whose title is close to a listed one: likely a typo. */
  nearMisses: {
    /** The normalized title, which a title match is keyed by. */
    key: string;
    suggestion: ProjectCandidate;
    title: string;
  }[];
  /** Email to the project key the student is pre-approved for. */
  pins: Map<string, string>;
}

/** The key of a project added from the roster; never a listed project's. */
export const rosterProjectKey = (normalized: string) => `roster:${normalized}`;

/**
 * Resolves each pre-approval's title as a bid's is, by normalized title and
 * then by the title matches staff made. A title that names no listed
 * project becomes a project of its own (#670).
 */
export function resolveRosterProjects(
  roster: readonly RosterEntry[],
  projects: readonly WorkspaceProject[],
  matches: Readonly<Record<string, { projectKey: string }>> = {}
): RosterAssignments {
  const keyByTitle = projectKeysByTitle(projects, matches);
  const pins = new Map<string, string>();
  const unlisted = new Map<string, { count: number; title: string }>();
  for (const entry of roster) {
    if (entry.project === undefined) {
      continue;
    }
    const normalized = normalizeTitle(entry.project);
    if (normalized === "") {
      continue;
    }
    const listed = keyByTitle.get(normalized);
    if (listed !== undefined) {
      pins.set(entry.email, listed);
      continue;
    }
    const seen = unlisted.get(normalized) ?? { count: 0, title: entry.project };
    seen.count += 1;
    unlisted.set(normalized, seen);
    pins.set(entry.email, rosterProjectKey(normalized));
  }
  const added: WorkspaceProject[] = [];
  const nearMisses: RosterAssignments["nearMisses"] = [];
  for (const [normalized, { count, title }] of unlisted) {
    added.push({
      key: rosterProjectKey(normalized),
      title,
      maxTeams: 1,
      minStudents: 1,
      maxStudents: count,
      weightMultiplier: 1,
      fromRoster: true,
    });
    const suggestion = suggestProject(rankProjects(title, projects));
    if (suggestion !== undefined) {
      nearMisses.push({ key: normalized, title, suggestion });
    }
  }
  return { added, nearMisses, pins };
}

/**
 * Board pins moved along when new title matches turn a roster project into a
 * listed one: a pin set on `roster:<title>` would otherwise name a project
 * that no longer exists.
 */
export function repointRosterPins(
  pins: Readonly<Record<string, string | null>> | undefined,
  added: Readonly<Record<string, { projectKey: string }>>
): Record<string, string | null> | undefined {
  if (pins === undefined) {
    return pins;
  }
  const moved = new Map(
    Object.entries(added).map(([title, m]) => [
      rosterProjectKey(title),
      m.projectKey,
    ])
  );
  return Object.fromEntries(
    Object.entries(pins).map(([email, key]) => [
      email,
      key === null ? null : (moved.get(key) ?? key),
    ])
  );
}

/** A student the bids file pinned elsewhere than the roster pre-approves. */
export interface PinConflict {
  email: string;
  /** The project key the bids file pinned. */
  fromBids: string;
  /** The project key the roster pre-approves, which wins. */
  fromRoster: string;
}

/**
 * The survey's students plus a student with no bids for every roster email
 * the survey lacks, merged on email. A survey student keeps the survey's
 * name. `notOnRoster` lists the survey students the roster lacks, who stay
 * in the run. A pre-approval pins its student, over a pin from the bids
 * file, and each such override is listed in `conflicts`.
 */
export function mergeRoster(
  students: readonly PlacementStudent[],
  roster: readonly RosterEntry[],
  pins: ReadonlyMap<string, string> = new Map()
): {
  conflicts: PinConflict[];
  notOnRoster: string[];
  students: PlacementStudent[];
} {
  const onRoster = new Set(roster.map((r) => r.email));
  const inSurvey = new Set(students.map((s) => s.email));
  const conflicts: PinConflict[] = [];
  const preApprove = (student: PlacementStudent): PlacementStudent => {
    const pin = pins.get(student.email);
    if (pin === undefined) {
      return student;
    }
    if (student.pin !== undefined && student.pin !== pin) {
      conflicts.push({
        email: student.email,
        fromBids: student.pin,
        fromRoster: pin,
      });
    }
    return { ...student, pin, preApproved: true };
  };
  const added: PlacementStudent[] = roster
    .filter((r) => !inSurvey.has(r.email))
    .map((r) => ({ email: r.email, name: r.name, bids: [], rosterOnly: true }));
  return {
    students: [...students, ...added].map(preApprove),
    notOnRoster: students
      .filter((s) => !onRoster.has(s.email))
      .map((s) => s.email),
    conflicts,
  };
}
