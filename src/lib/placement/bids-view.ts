import { ordinal } from "#/lib/placement/analytics";
import type { PlacementStudent, WorkspaceProject } from "#/lib/placement/types";
import type { StoredResult } from "#/lib/placement/workspace";

/**
 * The Bids tab's two views, derived and never stored. Per project (#671):
 * every project with the students who bid on it or are pinned there, so
 * staff can judge its bidders by what they wrote and pin one before any
 * run. Per student (#689): where each student stands after the last run.
 */

export interface ProjectBidRow {
  avoid: string | undefined;
  comment: string;
  email: string;
  /** The one row of a project nobody bid on or is pinned to. */
  empty: boolean;
  /**
   * The project was added from the roster and holds exactly its
   * pre-approved students, so nobody else may be pinned there (#670).
   */
  fixed: boolean;
  /** Unique within the view: a project and a student, or an empty project. */
  id: string;
  name: string;
  /** The title of the project the student is pinned to, when it is not
   * this one. */
  pinnedElsewhere: string | null;
  pinnedHere: boolean;
  /** Pinned here by a pre-approval on the roster (#670). */
  preApproved: boolean;
  /** Null for a student pinned here without bidding on it. */
  priority: number | null;
  projectKey: string;
  projectTitle: string;
}

/**
 * One row per bid, plus one per student pinned to a project they did not
 * bid on, grouped by project title and ordered by priority within a
 * project, with any pin-only rows last. A project with neither gets one
 * empty row, so it shows rather than going missing. `students` should carry
 * the pins in effect: the file's, the roster's and the board's.
 */
export function projectBidRows(
  students: readonly PlacementStudent[],
  projects: readonly WorkspaceProject[]
): ProjectBidRow[] {
  const titles = new Map(projects.map((p) => [p.key, p.title]));
  const fixed = new Set(projects.filter((p) => p.fromRoster).map((p) => p.key));
  const byProject = new Map<string, ProjectBidRow[]>(
    projects.map((p) => [p.key, []])
  );
  const add = (
    student: PlacementStudent,
    projectKey: string,
    priority: number | null,
    comment: string
  ) => {
    const rows = byProject.get(projectKey);
    if (rows === undefined) {
      return;
    }
    const pinnedHere = student.pin === projectKey;
    rows.push({
      id: `${projectKey}:${student.email}`,
      projectKey,
      projectTitle: titles.get(projectKey) ?? projectKey,
      email: student.email,
      name: student.name,
      avoid: student.avoid,
      priority,
      comment,
      pinnedHere,
      pinnedElsewhere:
        student.pin === undefined || pinnedHere
          ? null
          : (titles.get(student.pin) ?? student.pin),
      preApproved: pinnedHere && student.preApproved === true,
      empty: false,
      fixed: fixed.has(projectKey),
    });
  };
  for (const student of students) {
    for (const bid of student.bids) {
      add(student, bid.projectKey, bid.priority, bid.comment);
    }
    const { pin } = student;
    if (pin !== undefined && !student.bids.some((b) => b.projectKey === pin)) {
      add(student, pin, null, "");
    }
  }
  const byName = (a: ProjectBidRow, b: ProjectBidRow) =>
    (a.name || a.email).localeCompare(b.name || b.email);
  return [...projects]
    .sort((a, b) => a.title.localeCompare(b.title))
    .flatMap((project) => {
      const rows = byProject.get(project.key) ?? [];
      if (rows.length === 0) {
        return [emptyRow(project.key, project.title, fixed.has(project.key))];
      }
      return rows.sort(
        (a, b) =>
          (a.priority ?? Number.POSITIVE_INFINITY) -
            (b.priority ?? Number.POSITIVE_INFINITY) || byName(a, b)
      );
    });
}

/** The one row of a project with no one to list, so it shows anyway. */
function emptyRow(
  projectKey: string,
  projectTitle: string,
  fixed: boolean
): ProjectBidRow {
  return {
    id: `${projectKey}:`,
    projectKey,
    projectTitle,
    email: "",
    name: "",
    avoid: undefined,
    priority: null,
    comment: "",
    pinnedHere: false,
    pinnedElsewhere: null,
    preApproved: false,
    empty: true,
    fixed,
  };
}

/**
 * `projectBidRows` narrowed to the students pinned to each project (#688),
 * in the same order. A project with none keeps one empty row, so every
 * project still shows.
 */
export function pinnedRows(rows: readonly ProjectBidRow[]): ProjectBidRow[] {
  return [...groupByProject(rows).values()].flatMap((group) => {
    const pinned = group.filter((r) => r.pinnedHere);
    const [first] = group;
    return pinned.length > 0
      ? pinned
      : [emptyRow(first.projectKey, first.projectTitle, first.fixed)];
  });
}

/** Each project's rows by project key, in the order they came. */
export function groupByProject(
  rows: readonly ProjectBidRow[]
): Map<string, ProjectBidRow[]> {
  const byProject = new Map<string, ProjectBidRow[]>();
  for (const row of rows) {
    const group = byProject.get(row.projectKey);
    if (group) {
      group.push(row);
    } else {
      byProject.set(row.projectKey, [row]);
    }
  }
  return byProject;
}

/** How a student came to be pinned to a project, as its header lists them. */
export function pinSource(row: ProjectBidRow): string {
  if (row.preApproved) {
    return "pre-approved";
  }
  return row.priority === null ? "not in their bids" : ordinal(row.priority);
}

/**
 * Where a student stands (#689). A pinned student stands on the pin alone,
 * since every run keeps them there; `pending` says the last run placed them
 * somewhere else, which the next run changes. Anyone else stands where the
 * last run put them.
 */
export type Standing =
  | { kind: "pinned"; projectKey: string; pending: boolean }
  | {
      kind: "placed";
      priority: number | null;
      projectKey: string;
      rosterOnly: boolean;
      team: number;
    }
  | { kind: "unplaced" }
  | { kind: "not_in_run" }
  | { kind: "no_run" };

/** `student` should carry the pins in effect, the board's included. */
export function studentStanding(
  student: PlacementStudent,
  result: StoredResult | undefined
): Standing {
  const placement = result?.placements.find((p) => p.email === student.email);
  if (student.pin !== undefined) {
    return {
      kind: "pinned",
      projectKey: student.pin,
      pending: result !== undefined && placement?.projectKey !== student.pin,
    };
  }
  if (result === undefined) {
    return { kind: "no_run" };
  }
  if (placement !== undefined) {
    return {
      kind: "placed",
      projectKey: placement.projectKey,
      team: placement.team,
      priority: placement.priority,
      rosterOnly: student.rosterOnly ?? false,
    };
  }
  return result.unplaced.some((u) => u.email === student.email)
    ? { kind: "unplaced" }
    : { kind: "not_in_run" };
}

/**
 * The standing as a student's header says it. `stale` is set when the
 * projects, parameters or bids changed since the run, which a pin does not.
 */
export function standingText(
  standing: Standing,
  titles: ReadonlyMap<string, string>,
  stale: boolean
): string {
  const title = (key: string) => titles.get(key) ?? key;
  const before = stale ? " (before your changes)" : "";
  switch (standing.kind) {
    case "pinned":
      return `Pinned to ${title(standing.projectKey)}${standing.pending ? ", applies from the next run" : ""}`;
    case "placed": {
      let choice: string;
      if (standing.priority === null) {
        choice = standing.rosterOnly
          ? "not in the survey"
          : "not in their bids";
      } else {
        choice = ordinal(standing.priority);
      }
      return `Placed: ${title(standing.projectKey)}, team ${standing.team} (${choice})${before}`;
    }
    case "unplaced":
      return `Unplaced in the last run${before}`;
    case "not_in_run":
      return "Not in the last run";
    case "no_run":
      return "No run yet";
    default:
      return standing satisfies never;
  }
}
