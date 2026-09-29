import type { BoardRow } from "#/lib/placement/board";
import type { PlacementStudent, WorkspaceProject } from "#/lib/placement/types";

/**
 * The placement analytics Sheet's tables (#650), derived and never stored:
 * how the bids spread over the projects, and how the placement fell against
 * each student's priorities.
 */

export interface ProjectBids {
  firstChoice: number;
  key: string;
  title: string;
  total: number;
}

/**
 * Every project with its first-choice and total bids, fewest bids first, so a
 * project nobody picked is at the top rather than lost at the bottom.
 */
export function bidsPerProject(
  students: readonly PlacementStudent[],
  projects: readonly WorkspaceProject[]
): ProjectBids[] {
  const counts = new Map(
    projects.map((p) => [
      p.key,
      { key: p.key, title: p.title, firstChoice: 0, total: 0 },
    ])
  );
  for (const student of students) {
    for (const bid of student.bids) {
      const entry = counts.get(bid.projectKey);
      if (entry) {
        entry.total += 1;
        entry.firstChoice += bid.priority === 1 ? 1 : 0;
      }
    }
  }
  return [...counts.values()].sort(
    (a, b) =>
      a.total - b.total ||
      a.firstChoice - b.firstChoice ||
      a.title.localeCompare(b.title)
  );
}

export interface PriorityRow {
  count: number;
  label: string;
  /** Share of every student on the board, placed or not. */
  ofAll: number;
  /** Share of the students the placement placed. */
  ofPlaced: number;
}

const ORDINAL = new Intl.PluralRules("en-US", { type: "ordinal" });
const SUFFIX: Record<string, string> = {
  one: "st",
  two: "nd",
  few: "rd",
  other: "th",
};

/** "1st", "2nd", "11th": the priority a placement landed on. */
export function ordinal(n: number): string {
  return `${n}${SUFFIX[ORDINAL.select(n)]}`;
}

/**
 * How many placed students got each priority, from first to the last one
 * anybody got, with zeros in between, then the placements outside a
 * student's bids. Shares are fractions, not percentages.
 */
export function priorityDistribution(rows: readonly BoardRow[]): PriorityRow[] {
  const placed = rows.filter((r) => r.projectKey !== null);
  const share = (count: number, of: number) => (of === 0 ? 0 : count / of);
  const row = (label: string, count: number): PriorityRow => ({
    label,
    count,
    ofPlaced: share(count, placed.length),
    ofAll: share(count, rows.length),
  });
  // A pre-approved student counts there whatever their bids said (#670).
  const preApproved = placed.filter((r) => r.preApproved).length;
  const ranked = placed.filter((r) => !r.preApproved);
  const last = Math.max(0, ...ranked.map((r) => r.priority ?? 0));
  const byPriority = Array.from({ length: last }, (_, i) =>
    row(
      `${ordinal(i + 1)} choice`,
      ranked.filter((r) => r.priority === i + 1).length
    )
  );
  const outside = ranked.filter((r) => r.priority === null);
  const pinned = outside.filter((r) => r.pinned).length;
  const rosterOnly = outside.filter((r) => !r.pinned && r.rosterOnly).length;
  const unranked = outside.length - pinned - rosterOnly;
  return [
    ...byPriority,
    ...(preApproved > 0 ? [row("Pre-approved", preApproved)] : []),
    ...(pinned > 0 ? [row("Pinned outside their bids", pinned)] : []),
    ...(rosterOnly > 0
      ? [row("Placed without bids (not in the survey)", rosterOnly)]
      : []),
    ...(unranked > 0 ? [row("Placed outside their bids", unranked)] : []),
  ];
}

/**
 * `count` of `of` as a whole percent, rounded down so one student short of
 * everyone never reads 100%. Integer math: `(29 / 100) * 100` is 28.999...
 */
export function percentDown(count: number, of: number): number {
  return Math.floor((count * 100) / of);
}

export interface TeamSizeRow {
  size: number;
  /** Students on teams of this size: `size` times `teams`. */
  students: number;
  teams: number;
}

export interface TeamSizes {
  /** Smallest size first, only the sizes some team has. */
  bySize: TeamSizeRow[];
  /** `max`, `mean` and `min` are all null with no teams. */
  max: number | null;
  /** Placed students per team. */
  mean: number | null;
  min: number | null;
  /** Projects with at least one team. */
  projects: number;
  teams: number;
}

/**
 * How many teams the placement on the board formed and how big they are
 * (#701). A team is a project and team number with someone on it, counted
 * from the rows rather than the solver's team numbers, so a Move that starts
 * a project's first team counts, one student or not.
 */
export function teamSizes(rows: readonly BoardRow[]): TeamSizes {
  const sizes = new Map<string, number>();
  const projects = new Set<string>();
  for (const r of rows) {
    if (r.projectKey !== null) {
      const team = `${r.projectKey}\u0000${r.team}`;
      sizes.set(team, (sizes.get(team) ?? 0) + 1);
      projects.add(r.projectKey);
    }
  }
  const counts = new Map<number, number>();
  for (const size of sizes.values()) {
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  const bySize = [...counts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([size, count]) => ({ size, teams: count, students: size * count }));
  const teams = sizes.size;
  const placed = bySize.reduce((sum, r) => sum + r.students, 0);
  return {
    bySize,
    teams,
    projects: projects.size,
    mean: teams === 0 ? null : placed / teams,
    min: bySize[0]?.size ?? null,
    max: bySize.at(-1)?.size ?? null,
  };
}
