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
  const last = Math.max(0, ...placed.map((r) => r.priority ?? 0));
  const byPriority = Array.from({ length: last }, (_, i) =>
    row(
      `${ordinal(i + 1)} choice`,
      placed.filter((r) => r.priority === i + 1).length
    )
  );
  const outside = placed.filter((r) => r.priority === null);
  const pinned = outside.filter((r) => r.pinned).length;
  return [
    ...byPriority,
    ...(pinned > 0 ? [row("Pinned outside their bids", pinned)] : []),
    ...(outside.length - pinned > 0
      ? [row("Placed outside their bids", outside.length - pinned)]
      : []),
  ];
}
