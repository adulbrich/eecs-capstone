import Papa from "papaparse";
import { unguardCell } from "#/lib/csv";
import type { PlacementStudent, WorkspaceProject } from "#/lib/placement/types";

/**
 * Parsing for the two files placement imports. Both run in the staff
 * member's browser and never reach the server (ADR-0056). A row with an
 * error stays out of the run; every problem is reported, not just the first,
 * so one pass over the file fixes all of them.
 */

export interface ImportIssue {
  level: "error" | "warning";
  message: string;
  /** Spreadsheet row: the header is row 1, the first record row 2. */
  row: number;
  /** Every row the issue covers, when it covers more than one. */
  rows?: number[];
}

/**
 * How a bid names its project, and how a CSV project is keyed: case, runs of
 * spaces and trailing punctuation ("system:") do not tell two titles apart.
 */
const TRAILING_PUNCTUATION = /[\s.,:;!?]+$/;

export function normalizeTitle(title: string): string {
  return title
    .normalize("NFC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(TRAILING_PUNCTUATION, "")
    .toLowerCase();
}

type Row = Record<string, string | undefined>;

function parseRows(text: string): {
  fields: string[];
  issues: ImportIssue[];
  rows: Row[];
} {
  // Papa renames a repeated header ("title_1") and keeps both columns, so a
  // reader keyed by name would silently use one and drop the other.
  const seen = new Set<string>();
  const repeated = new Set<string>();
  const parsed = Papa.parse<Row>(text, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => {
      const name = header.trim().toLowerCase();
      if (seen.has(name)) {
        repeated.add(name);
      }
      seen.add(name);
      return name;
    },
  });
  if (repeated.size > 0) {
    return {
      fields: [],
      rows: [],
      issues: [...repeated].map((name) => ({
        level: "error",
        row: 1,
        message: `The header has "${name}" more than once; each column must appear once.`,
      })),
    };
  }
  const issues: ImportIssue[] = parsed.errors
    // A one-column file has no delimiter to detect, and is still valid.
    .filter((e) => e.code !== "UndetectableDelimiter")
    .map((e) => ({
      level: "error",
      row: (e.row ?? -1) + 2,
      message: e.message,
    }));
  return { fields: parsed.meta.fields ?? [], issues, rows: parsed.data };
}

function missingColumns(fields: string[], required: string[]): ImportIssue[] {
  return required
    .filter((column) => !fields.includes(column))
    .map((column) => ({
      level: "error",
      row: 1,
      message: `The file has no "${column}" column.`,
    }));
}

const cell = (row: Row, column: string) =>
  unguardCell((row[column] ?? "").trim());

/** Blank is undefined; anything but a whole number at or above `min` is invalid. */
function parseCount(
  value: string,
  min: number
): number | undefined | "invalid" {
  if (value === "") {
    return;
  }
  const n = Number(value);
  return Number.isInteger(n) && n >= min ? n : "invalid";
}

const TRUE_FLAGS = new Set(["true", "yes", "y", "1", "x"]);
const FALSE_FLAGS = new Set(["", "false", "no", "n", "0"]);

function parseFlag(value: string): boolean | "invalid" {
  const v = value.toLowerCase();
  if (TRUE_FLAGS.has(v)) {
    return true;
  }
  return FALSE_FLAGS.has(v) ? false : "invalid";
}

/**
 * `title, max_teams, min_students, max_students`. Only `title` is required,
 * and a blank number takes the page default. A CSV project is keyed by its
 * normalized title, which is also how bids find it.
 */
export function parseProjectsCsv(text: string): {
  issues: ImportIssue[];
  projects: WorkspaceProject[];
} {
  const { fields, issues, rows } = parseRows(text);
  const missing =
    fields.length === 0 && issues.length > 0
      ? []
      : missingColumns(fields, ["title"]);
  if (missing.length > 0) {
    return { projects: [], issues: [...issues, ...missing] };
  }
  const projects: WorkspaceProject[] = [];
  const firstRow = new Map<string, number>();
  const failedRows = new Set(issues.map((i) => i.row));
  rows.forEach((raw, index) => {
    const row = index + 2;
    if (failedRows.has(row)) {
      return;
    }
    const error = (message: string) =>
      issues.push({ level: "error", row, message });
    const title = cell(raw, "title").replace(/\s+/g, " ");
    if (title === "") {
      error("The row has no title.");
      return;
    }
    const maxTeams = parseCount(cell(raw, "max_teams"), 0);
    const minStudents = parseCount(cell(raw, "min_students"), 1);
    const maxStudents = parseCount(cell(raw, "max_students"), 1);
    if (maxTeams === "invalid") {
      error("max_teams must be a whole number, 0 or more.");
      return;
    }
    if (minStudents === "invalid" || maxStudents === "invalid") {
      error("min_students and max_students must be whole numbers, 1 or more.");
      return;
    }
    if (
      minStudents !== undefined &&
      maxStudents !== undefined &&
      minStudents > maxStudents
    ) {
      error("min_students is above max_students.");
      return;
    }
    const key = normalizeTitle(title);
    const earlier = firstRow.get(key);
    if (earlier !== undefined) {
      error(`The same title as row ${earlier}.`);
      return;
    }
    firstRow.set(key, row);
    projects.push({
      key,
      title,
      maxTeams,
      minStudents,
      maxStudents,
      weightMultiplier: 1,
    });
  });
  return { projects, issues };
}

interface StudentDraft {
  pinRow?: number;
  priorities: Map<number, number>;
  projects: Map<string, number>;
  student: PlacementStudent;
}

interface BidRow {
  avoid: string;
  comment: string;
  email: string;
  name: string;
  pinned: boolean;
  priority: number | undefined;
  projectKey: string;
}

/** The row's own cells, checked without looking at any other row. */
function readBidRow(
  raw: Row,
  keyByTitle: Map<string, string>
): BidRow | { error: string } | { unknownTitle: string } {
  const email = cell(raw, "email").toLowerCase();
  const projectTitle = cell(raw, "project");
  if (email === "") {
    return { error: "The row has no email." };
  }
  if (projectTitle === "") {
    return { error: "The row has no project." };
  }
  const pinned = parseFlag(cell(raw, "override"));
  if (pinned === "invalid") {
    return {
      error:
        "override must be true or false (yes and no, or 1 and 0, work too).",
    };
  }
  const priorityCell = cell(raw, "priority");
  const priority = priorityCell === "" ? undefined : Number(priorityCell);
  if (priority === undefined && !pinned) {
    return {
      error:
        "The row has no priority, and only a pinned row may leave it blank.",
    };
  }
  if (
    priority !== undefined &&
    !(Number.isInteger(priority) && priority >= 1)
  ) {
    return { error: "priority must be a whole number, 1 or more." };
  }
  const projectKey = keyByTitle.get(normalizeTitle(projectTitle));
  if (projectKey === undefined) {
    return { unknownTitle: projectTitle };
  }
  return {
    email,
    name: cell(raw, "name"),
    priority,
    projectKey,
    pinned,
    comment: cell(raw, "comment"),
    avoid: cell(raw, "avoid"),
  };
}

/** What the row repeats from the same student's earlier rows, if anything. */
function conflictWithEarlierRows(
  bid: BidRow,
  draft: StudentDraft | undefined
): string | undefined {
  if (draft === undefined) {
    return;
  }
  const earlierPriority =
    bid.priority === undefined ? undefined : draft.priorities.get(bid.priority);
  if (earlierPriority !== undefined) {
    return `Priority ${bid.priority} repeats row ${earlierPriority} for ${bid.email}.`;
  }
  const earlierProject = draft.projects.get(bid.projectKey);
  if (earlierProject !== undefined) {
    return `The same project as row ${earlierProject} for ${bid.email}.`;
  }
  if (bid.pinned && draft.pinRow !== undefined) {
    return `A second pin for ${bid.email}; the first is on row ${draft.pinRow}.`;
  }
}

function applyBidRow(
  bid: BidRow,
  row: number,
  draft: StudentDraft,
  issues: ImportIssue[]
) {
  const { student } = draft;
  if (student.name === "") {
    student.name = bid.name;
  } else if (bid.name !== "" && bid.name !== student.name) {
    issues.push({
      level: "warning",
      row,
      message: `The name "${bid.name}" differs from "${student.name}" for ${bid.email}; keeping the first.`,
    });
  }
  draft.projects.set(bid.projectKey, row);
  if (bid.priority !== undefined) {
    draft.priorities.set(bid.priority, row);
    student.bids.push({
      projectKey: bid.projectKey,
      priority: bid.priority,
      comment: bid.comment,
    });
  }
  if (bid.pinned) {
    draft.pinRow = row;
    student.pin = bid.projectKey;
  }
  if (bid.avoid !== "" && student.avoid === undefined) {
    student.avoid = bid.avoid;
  }
}

/**
 * `email, name, priority, project, comment, override, avoid`, one row per
 * bid. `override` true pins the student to that row's project, and may leave
 * `priority` blank for a project outside their bids. `avoid` is read from the
 * student's first row that has one.
 */
export function parseBidsCsv(
  text: string,
  projects: readonly Pick<WorkspaceProject, "key" | "title">[]
): { issues: ImportIssue[]; students: PlacementStudent[] } {
  const { fields, issues, rows } = parseRows(text);
  const missing =
    fields.length === 0 && issues.length > 0
      ? []
      : missingColumns(fields, ["email", "priority", "project"]);
  if (missing.length > 0) {
    return { students: [], issues: [...issues, ...missing] };
  }
  const keyByTitle = new Map(
    projects.map((p) => [normalizeTitle(p.title), p.key])
  );
  const drafts = new Map<string, StudentDraft>();
  const failedRows = new Set(issues.map((i) => i.row));
  // A survey title that matches no project usually does so on every row
  // that names it, so it is one issue listing its rows, not one per row.
  const unknown = new Map<string, { rows: number[]; title: string }>();

  rows.forEach((raw, index) => {
    const row = index + 2;
    if (failedRows.has(row)) {
      return;
    }
    const bid = readBidRow(raw, keyByTitle);
    if ("unknownTitle" in bid) {
      const key = normalizeTitle(bid.unknownTitle);
      const entry = unknown.get(key) ?? { title: bid.unknownTitle, rows: [] };
      entry.rows.push(row);
      unknown.set(key, entry);
      return;
    }
    if ("error" in bid) {
      issues.push({ level: "error", row, message: bid.error });
      return;
    }
    const existing = drafts.get(bid.email);
    const conflict = conflictWithEarlierRows(bid, existing);
    if (conflict !== undefined) {
      issues.push({ level: "error", row, message: conflict });
      return;
    }
    const draft = existing ?? {
      priorities: new Map(),
      projects: new Map(),
      student: { email: bid.email, name: "", bids: [] },
    };
    drafts.set(bid.email, draft);
    applyBidRow(bid, row, draft, issues);
  });

  for (const { title, rows: titled } of unknown.values()) {
    issues.push({
      level: "error",
      row: titled[0],
      rows: titled,
      message: `No project is titled "${title}" (${titled.length} ${titled.length === 1 ? "bid" : "bids"}).`,
    });
  }
  return {
    students: [...drafts.values()].map((d) => d.student),
    issues: issues.sort((a, b) => a.row - b.row),
  };
}
