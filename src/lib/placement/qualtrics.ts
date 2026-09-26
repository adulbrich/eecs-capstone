import Papa from "papaparse";
import { toCsv } from "#/lib/csv";
import { type ImportIssue, normalizeTitle } from "#/lib/placement/csv";
import { BIDS_FORMAT } from "#/lib/placement/formats";
import type { WorkspaceProject } from "#/lib/placement/types";

/**
 * The bidding survey's Qualtrics export, turned into the long bids format
 * the rest of placement reads (#656). A Qualtrics export is wide: one row
 * per response, one column per project holding its rank, and three header
 * rows (short ids, question text, ImportId JSON), so data starts on row 4.
 *
 * Columns are found by their question text rather than by QID, because QIDs
 * change whenever someone rebuilds the survey and the wording rarely does.
 * The ranking question is the one whose text mentions ranking; each of its
 * columns is "<question> - <project title>", and the title is everything
 * after the first " - ", so a title that itself contains " - " survives.
 */

type Grid = string[][];

const FIRST_DATA_ROW = 3;

interface Columns {
  avoid?: number;
  email: number;
  finished?: number;
  firstName?: number;
  lastName?: number;
  preAssigned?: number;
  preAssignedProject?: number;
  ranks: { column: number; title: string }[];
  reasons: Map<number, number>;
  recorded?: number;
  status?: number;
}

function importId(cell: string | undefined): string | undefined {
  if (!cell?.startsWith("{")) {
    return;
  }
  try {
    const parsed: unknown = JSON.parse(cell);
    return typeof parsed === "object" &&
      parsed !== null &&
      "ImportId" in parsed &&
      typeof parsed.ImportId === "string"
      ? parsed.ImportId
      : undefined;
  } catch {
    // Not JSON: not an ImportId cell.
  }
}

/** True when the file's third row carries Qualtrics' ImportId JSON. */
export function isQualtricsExport(text: string): boolean {
  const { data } = Papa.parse<string[]>(text, { preview: 3 });
  return (data[2] ?? []).some((cell) => importId(cell) !== undefined);
}

const RANK_QUESTION = /\brank\b/i;
const REASON = /reason for choice (\d+)\s*$/i;
const AVOID_QUESTION = /prefer not to work with/i;
const PRE_ASSIGNED_QUESTION = /pre-?assigned/i;
const PROJECT_NAME_QUESTION = /name of your project/i;

function findColumns(
  grid: Grid
): { columns: Columns; notes: string[] } | string {
  const ids = (grid[2] ?? []).map(importId);
  const text = grid[1] ?? [];
  const byId = (id: string) => {
    const index = ids.indexOf(id);
    return index === -1 ? undefined : index;
  };
  const email = byId("recipientEmail");
  if (email === undefined) {
    return "The export has no Recipient Email column, so its responses cannot be told apart.";
  }
  const columns: Columns = {
    email,
    firstName: byId("recipientFirstName"),
    lastName: byId("recipientLastName"),
    status: byId("status"),
    finished: byId("finished"),
    recorded: byId("recordedDate"),
    ranks: [],
    reasons: new Map(),
  };
  // The first ranking question is the one; a survey with a second (backup
  // choices, say) would otherwise merge two sets of ranks into one.
  let rankStem: string | undefined;
  const ignoredStems = new Set<string>();
  text.forEach((question, column) => {
    const dash = question.indexOf(" - ");
    const stem = dash === -1 ? question : question.slice(0, dash);
    const reason = REASON.exec(question);
    if (reason) {
      columns.reasons.set(Number(reason[1]), column);
    } else if (dash !== -1 && RANK_QUESTION.test(stem)) {
      rankStem ??= stem;
      if (stem === rankStem) {
        columns.ranks.push({ column, title: question.slice(dash + 3).trim() });
      } else {
        ignoredStems.add(stem);
      }
    } else if (AVOID_QUESTION.test(question)) {
      columns.avoid = column;
    } else if (PRE_ASSIGNED_QUESTION.test(question)) {
      columns.preAssigned = column;
    } else if (PROJECT_NAME_QUESTION.test(question)) {
      columns.preAssignedProject = column;
    }
  });
  if (columns.ranks.length === 0) {
    return "The export has no ranking question (one whose text mentions ranking, with a column per project).";
  }
  // Columns found by their wording: say so when one is missing, rather than
  // dropping it without a word after the survey is reworded.
  const notes = [...ignoredStems].map(
    (stem) => `Only the first ranking question is used; "${stem}" is ignored.`
  );
  if (columns.avoid === undefined) {
    notes.push(
      'No "prefer not to work with" question was found, so no answers to it are shown.'
    );
  }
  if (
    columns.preAssigned === undefined ||
    columns.preAssignedProject === undefined
  ) {
    notes.push(
      "No pre-assigned project question was found, so nobody is pinned from the survey."
    );
  }
  return { columns, notes };
}

const YES = new Set(["yes", "1", "true"]);
const PREVIEW = new Set(["survey preview", "1"]);
const UNFINISHED = new Set(["false", "0"]);

type LongRow = Record<string, string>;

const at = (row: string[], column: number | undefined) =>
  column === undefined ? "" : (row[column] ?? "").trim();

/**
 * The export as long bids CSV text, and what the conversion noticed. Row
 * numbers in the issues are the export's own, so a reader can find them in
 * the file they uploaded.
 */
export function convertQualtrics(
  text: string,
  projects: readonly Pick<WorkspaceProject, "title">[]
): { csv: string; issues: ImportIssue[] } {
  const grid = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;
  const found = findColumns(grid);
  if (typeof found === "string") {
    return {
      csv: "",
      issues: [{ level: "error", row: 1, message: found }],
    };
  }
  const { columns } = found;
  const known = new Set(projects.map((p) => normalizeTitle(p.title)));
  const issues: ImportIssue[] = found.notes.map((message) => ({
    level: "warning",
    row: 1,
    message,
  }));

  // The latest response per email wins; earlier ones are reported.
  const latest = new Map<string, { recorded: string; row: number }>();
  const responses: { email: string; row: number; values: string[] }[] = [];
  grid.slice(FIRST_DATA_ROW).forEach((values, index) => {
    const row = index + FIRST_DATA_ROW + 1;
    if (PREVIEW.has(at(values, columns.status).toLowerCase())) {
      issues.push({
        level: "warning",
        row,
        message: "A survey preview, not a response; skipped.",
      });
      return;
    }
    const email = at(values, columns.email).toLowerCase();
    if (email === "") {
      issues.push({
        level: "error",
        row,
        message: "The response has no recipient email.",
      });
      return;
    }
    if (UNFINISHED.has(at(values, columns.finished).toLowerCase())) {
      issues.push({
        level: "warning",
        row,
        message: `${email} did not finish the survey; their answers are used as they are.`,
      });
    }
    const recorded = at(values, columns.recorded);
    const previous = latest.get(email);
    if (previous === undefined || recorded >= previous.recorded) {
      latest.set(email, { recorded, row });
    }
    responses.push({ email, row, values });
  });

  const rows: LongRow[] = [];
  for (const { email, row, values } of responses) {
    const kept = latest.get(email);
    if (kept?.row !== row) {
      issues.push({
        level: "warning",
        row,
        message: `${email} answered again on row ${kept?.row}; this earlier response is not used.`,
      });
      continue;
    }
    rows.push(...responseRows(values, row, columns, known, issues));
  }

  const csv = toCsv(
    BIDS_FORMAT.columns.map((c) => ({
      header: c.name,
      value: (r: LongRow) => r[c.name] ?? "",
    })),
    rows
  );
  return { csv, issues: issues.sort((a, b) => a.row - b.row) };
}

/** One response's bids, and its pin when the student was pre-assigned. */
function responseRows(
  values: string[],
  row: number,
  columns: Columns,
  known: Set<string>,
  issues: ImportIssue[]
): LongRow[] {
  const email = at(values, columns.email).toLowerCase();
  const student = {
    email,
    name: [at(values, columns.firstName), at(values, columns.lastName)]
      .filter(Boolean)
      .join(" "),
    avoid: at(values, columns.avoid),
  };
  const bids: LongRow[] = columns.ranks
    .map(({ column, title }) => ({ title, priority: at(values, column) }))
    .filter((b) => b.priority !== "")
    .map(({ title, priority }) => ({
      ...student,
      priority,
      project: title,
      comment: at(values, columns.reasons.get(Number(priority))),
      override: "",
    }));

  const ranked = new Set(bids.map((b) => Number(b.priority)));
  for (const [choice, column] of columns.reasons) {
    if (!ranked.has(choice) && at(values, column) !== "") {
      issues.push({
        level: "warning",
        row,
        message: `${email} gave a reason for choice ${choice} but ranked no project ${choice}; the reason is not used.`,
      });
    }
  }

  const typed = at(values, columns.preAssignedProject);
  if (!YES.has(at(values, columns.preAssigned).toLowerCase())) {
    return bids;
  }
  if (typed === "") {
    issues.push({
      level: "warning",
      row,
      message: `${email} says they were pre-assigned but named no project; nothing is pinned.`,
    });
    return bids;
  }
  if (!known.has(normalizeTitle(typed))) {
    issues.push({
      level: "warning",
      row,
      message: `${email} says they were pre-assigned to "${typed}", which matches no project; nothing is pinned.`,
    });
    return bids;
  }
  const pinnedBid = bids.find(
    (b) => normalizeTitle(b.project) === normalizeTitle(typed)
  );
  if (pinnedBid) {
    pinnedBid.override = "true";
    return bids;
  }
  return [
    ...bids,
    { ...student, priority: "", project: typed, comment: "", override: "true" },
  ];
}
