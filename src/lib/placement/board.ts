import { toCsv } from "#/lib/csv";
import { BIDS_FORMAT } from "#/lib/placement/formats";
import type {
  PlacementStudent,
  UnplacedReason,
  WorkspaceProject,
} from "#/lib/placement/types";
import type { StoredResult } from "#/lib/placement/workspace";

/**
 * The results board's pure half (#649): the students a run reads once the
 * board's pins are applied, the rows the board shows, a Move, and the two
 * files it downloads. Nothing here touches storage or the solver.
 */

/** The bids file's students, with the pins set on the board applied over it. */
export function applyPins(
  students: readonly PlacementStudent[],
  pins: Readonly<Record<string, string | null>> = {}
): PlacementStudent[] {
  return students.map((student) => {
    if (!(student.email in pins)) {
      return student;
    }
    const pin = pins[student.email];
    const { pin: _fromFile, ...rest } = student;
    return pin === null ? rest : { ...rest, pin };
  });
}

export interface BoardRow {
  avoid: string | undefined;
  /** The comment the student wrote for the project they are on. */
  comment: string;
  email: string;
  /** Unplaced first, then projects by title, then teams in order. */
  groupKey: string;
  groupLabel: string;
  name: string;
  pinned: boolean;
  /** The priority they gave the project they are on, or null. */
  priority: number | null;
  projectKey: string | null;
  team: number | null;
  unplacedReason: UnplacedReason | "not_in_run" | null;
}

const UNPLACED_GROUP = "0:unplaced";

/**
 * One row per student, in the fixed order the grouped table renders: the
 * unplaced group first, then each project by title and each team in order.
 * A student in the bids file but absent from the result (added after the
 * run) is unplaced too, so nobody goes missing from the board.
 */
export function boardRows(
  result: StoredResult,
  students: readonly PlacementStudent[],
  projects: readonly WorkspaceProject[]
): BoardRow[] {
  const byEmail = new Map(students.map((s) => [s.email, s]));
  const titles = new Map(projects.map((p) => [p.key, p.title]));
  const titleOrder = [...projects]
    .sort((a, b) => a.title.localeCompare(b.title))
    .map((p) => p.key);
  const rank = new Map(titleOrder.map((key, i) => [key, i]));
  const placed = new Set(result.placements.map((p) => p.email));
  const reasons = new Map(result.unplaced.map((u) => [u.email, u.reason]));

  const row = (
    student: PlacementStudent,
    projectKey: string | null,
    team: number | null
  ): BoardRow => {
    const bid = student.bids.find((b) => b.projectKey === projectKey);
    const index = projectKey === null ? -1 : (rank.get(projectKey) ?? 9999);
    return {
      email: student.email,
      name: student.name,
      avoid: student.avoid,
      projectKey,
      team,
      priority: bid?.priority ?? null,
      comment: bid?.comment ?? "",
      pinned: projectKey !== null && student.pin === projectKey,
      unplacedReason:
        projectKey === null
          ? (reasons.get(student.email) ?? "not_in_run")
          : null,
      groupKey:
        projectKey === null
          ? UNPLACED_GROUP
          : `1:${String(index).padStart(4, "0")}:${String(team).padStart(2, "0")}`,
      groupLabel:
        projectKey === null
          ? "Unplaced"
          : `${titles.get(projectKey) ?? projectKey}, team ${team}`,
    };
  };

  const rows: BoardRow[] = [];
  for (const p of result.placements) {
    const student = byEmail.get(p.email);
    if (student) {
      rows.push(row(student, p.projectKey, p.team));
    }
  }
  for (const student of students) {
    if (!placed.has(student.email)) {
      rows.push(row(student, null, null));
    }
  }
  return rows.sort(
    (a, b) =>
      a.groupKey.localeCompare(b.groupKey) ||
      (a.priority ?? 99) - (b.priority ?? 99) ||
      (a.name || a.email).localeCompare(b.name || b.email)
  );
}

/** Projects allowed a team that the result formed none for, by title. */
export function projectsWithoutTeam(
  result: StoredResult,
  projects: readonly WorkspaceProject[],
  defaultMaxTeams: number
): WorkspaceProject[] {
  const formed = new Set(result.placements.map((p) => p.projectKey));
  return projects
    .filter((p) => (p.maxTeams ?? defaultMaxTeams) > 0 && !formed.has(p.key))
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * The result with one student moved by hand. The solver chooses teams and a
 * Move cannot, so the student joins the target project's smallest team (its
 * first, if none formed) and the result is marked edited until the next run
 * sorts the teams out again.
 */
export function moveStudent(
  result: StoredResult,
  email: string,
  projectKey: string,
  priority: number | null
): StoredResult {
  const others = result.placements.filter((p) => p.email !== email);
  const sizes = new Map<number, number>();
  for (const p of others) {
    if (p.projectKey === projectKey) {
      sizes.set(p.team, (sizes.get(p.team) ?? 0) + 1);
    }
  }
  const team =
    [...sizes.entries()].sort((a, b) => a[1] - b[1] || a[0] - b[0])[0]?.[0] ??
    1;
  return {
    ...result,
    edited: true,
    placements: [...others, { email, projectKey, team, priority }],
    unplaced: result.unplaced.filter((u) => u.email !== email),
  };
}

type Row = Record<string, string | number | null>;

/** One row per student, unplaced ones with a blank project and team. */
export function placementCsv(
  rows: readonly BoardRow[],
  titles: Map<string, string>
) {
  return toCsv(
    [
      { header: "email", value: (r: Row) => r.email },
      { header: "name", value: (r: Row) => r.name },
      { header: "project", value: (r: Row) => r.project },
      { header: "team", value: (r: Row) => r.team },
      { header: "priority", value: (r: Row) => r.priority },
      { header: "comment", value: (r: Row) => r.comment },
      { header: "avoid", value: (r: Row) => r.avoid },
    ],
    rows.map((r) => ({
      email: r.email,
      name: r.name,
      project:
        r.projectKey === null ? "" : (titles.get(r.projectKey) ?? r.projectKey),
      team: r.team,
      priority: r.priority,
      comment: r.comment,
      avoid: r.avoid ?? "",
    }))
  );
}

/**
 * The bids file again, with `override` rewritten from the pins in effect and
 * a blank-priority row for a pin outside a student's bids, so uploading it
 * brings back the same students and pins.
 */
export function bidsWithPinsCsv(
  students: readonly PlacementStudent[],
  titles: Map<string, string>
): string {
  const title = (key: string) => titles.get(key) ?? key;
  const rows: Record<string, string>[] = students.flatMap((s) => {
    const base = { email: s.email, name: s.name, avoid: s.avoid ?? "" };
    const bidRows = s.bids.map((b) => ({
      ...base,
      priority: String(b.priority),
      project: title(b.projectKey),
      comment: b.comment,
      override: s.pin === b.projectKey ? "true" : "",
    }));
    if (s.pin === undefined || s.bids.some((b) => b.projectKey === s.pin)) {
      return bidRows;
    }
    return [
      ...bidRows,
      {
        ...base,
        priority: "",
        project: title(s.pin),
        comment: "",
        override: "true",
      },
    ];
  });
  return toCsv(
    BIDS_FORMAT.columns.map((c) => ({
      header: c.name,
      value: (r: Record<string, string>) => r[c.name] ?? "",
    })),
    rows
  );
}
