import {
  cell,
  type ImportIssue,
  missingColumns,
  parseRows,
  pastedLines,
} from "#/lib/placement/csv";
import type { PlacementStudent } from "#/lib/placement/types";

/**
 * The class roster (#665): every student in the class, so the ones who never
 * answered the bidding survey are placed too. It comes as a CSV or as pasted
 * emails, and merges with the bids on email. Browser only (ADR-0056).
 */

export interface RosterEntry {
  /** Lowercased and trimmed; the key the merge uses. */
  email: string;
  name: string;
}

export interface ParsedRoster {
  entries: RosterEntry[];
  issues: ImportIssue[];
}

const EMAIL = /^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/;
const NAMED = /^(.*)<([^<>]+)>$/;
const ITEM_SEPARATOR = /[,;]/;
const WHITESPACE = /\s+/;
const QUOTES = /^["']|["']$/g;

export const isEmail = (text: string) => EMAIL.test(text);

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

/** `email, name`, one row per student; only `email` is required. */
export function parseRosterCsv(text: string): ParsedRoster {
  const { fields, issues, rows } = parseRows(text);
  const missing =
    fields.length === 0 && issues.length > 0
      ? []
      : missingColumns(fields, ["email"]);
  if (missing.length > 0) {
    return { entries: [], issues: [...issues, ...missing] };
  }
  const entries: RosterEntry[] = [];
  const seen = new Map<string, number>();
  const failedRows = new Set(issues.map((i) => i.row));
  rows.forEach((raw, index) => {
    const row = index + 2;
    if (failedRows.has(row)) {
      return;
    }
    const email = cell(raw, "email").toLowerCase();
    if (!isEmail(email)) {
      issues.push({
        level: "error",
        row,
        message:
          email === ""
            ? "The row has no email."
            : `"${email}" is not an email.`,
      });
      return;
    }
    collect(
      entries,
      seen,
      issues,
      row,
      { email, name: cell(raw, "name") },
      "row"
    );
  });
  return { entries, issues: issues.sort((a, b) => a.row - b.row) };
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
    for (const raw of content.split(ITEM_SEPARATOR)) {
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
  return { entries, issues };
}

/**
 * The survey's students plus a student with no bids for every roster email
 * the survey lacks, merged on email. A survey student keeps the survey's
 * name. `notOnRoster` lists the survey students the roster lacks, who stay
 * in the run.
 */
export function mergeRoster(
  students: readonly PlacementStudent[],
  roster: readonly RosterEntry[]
): { notOnRoster: string[]; students: PlacementStudent[] } {
  const onRoster = new Set(roster.map((r) => r.email));
  const inSurvey = new Set(students.map((s) => s.email));
  const added: PlacementStudent[] = roster
    .filter((r) => !inSurvey.has(r.email))
    .map((r) => ({ email: r.email, name: r.name, bids: [], rosterOnly: true }));
  return {
    students: [...students, ...added],
    notOnRoster: students
      .filter((s) => !onRoster.has(s.email))
      .map((s) => s.email),
  };
}
