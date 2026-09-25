import type {
  PlacementDiagnostics,
  PlacementInput,
  PlacementProject,
  PlacementStudent,
  Unplaced,
} from "#/lib/placement/types";

/**
 * The mixed-integer program behind placement, as plain arrays, so it can be
 * checked in a test without a solver and handed to HiGHS without parsing.
 * The model is the one `project-bids-f2025.R` solved, minus that term's
 * one-off rules:
 *
 * - one column per team a project may form (`a`), 1 when that team forms;
 * - one column per student per team they may join (`y`), weighted by the
 *   priority they gave the project;
 * - every placeable student is on exactly one team;
 * - a formed team holds min to max students, an unformed one none;
 * - a project's teams form in order, which removes symmetric solutions;
 * - with the at-least-one rule on, a project that enough students may join
 *   forms at least one team.
 */

export interface TeamSlot {
  max: number;
  min: number;
  projectKey: string;
  /** 1-based, within the project. */
  team: number;
}

export interface TeamColumn {
  cost: 0;
  kind: "team";
  slot: number;
}

export interface PlacementColumn {
  cost: number;
  kind: "placement";
  /** The priority the student gave the project, or null outside their bids. */
  priority: number | null;
  slot: number;
  /** Index into `PlacementModel.students`. */
  student: number;
}

export type ModelColumn = TeamColumn | PlacementColumn;

export interface ModelRow {
  /** `[column index, coefficient]` pairs. */
  entries: [number, number][];
  lower: number;
  upper: number;
}

export interface PlacementModel {
  columns: ModelColumn[];
  diagnostics: PlacementDiagnostics;
  rows: ModelRow[];
  slots: TeamSlot[];
  /** The students the model places, in column order. */
  students: PlacementStudent[];
  unplaced: Unplaced[];
}

export function buildPlacementModel(input: PlacementInput): PlacementModel {
  const { parameters } = input;
  const active = input.projects.filter((p) => p.maxTeams > 0);
  const bounds = (p: PlacementProject) => ({
    min: p.minStudents ?? parameters.minStudents,
    max: p.maxStudents ?? parameters.maxStudents,
  });
  const { students, eligibleByStudent, unplaced } = resolveEligibility(
    input,
    active
  );

  const slots: TeamSlot[] = [];
  const slotsByProject = new Map<string, number[]>();
  for (const project of active) {
    const indices: number[] = [];
    for (let team = 1; team <= project.maxTeams; team++) {
      indices.push(slots.length);
      slots.push({ projectKey: project.key, team, ...bounds(project) });
    }
    slotsByProject.set(project.key, indices);
  }

  const columns: ModelColumn[] = slots.map((_, slot) => ({
    kind: "team",
    slot,
    cost: 0,
  }));
  const rows: ModelRow[] = [];
  const columnsBySlot: number[][] = slots.map(() => []);

  students.forEach((student, s) => {
    const entries: [number, number][] = [];
    for (const project of eligibleByStudent[s]) {
      const bid = student.bids.find((b) => b.projectKey === project.key);
      const weight =
        bid === undefined ? 0 : (parameters.rankWeights[bid.priority - 1] ?? 0);
      const cost = Math.round(weight * project.weightMultiplier);
      for (const slot of slotsByProject.get(project.key) ?? []) {
        const column = columns.length;
        columns.push({
          kind: "placement",
          slot,
          student: s,
          priority: bid?.priority ?? null,
          cost,
        });
        columnsBySlot[slot].push(column);
        entries.push([column, 1]);
      }
    }
    rows.push({ entries, lower: 1, upper: 1 });
  });

  slots.forEach((slot, k) => {
    const members = columnsBySlot[k].map((c): [number, number] => [c, 1]);
    rows.push({
      entries: [...members, [k, -slot.min]],
      lower: 0,
      upper: Number.POSITIVE_INFINITY,
    });
    rows.push({
      entries: [...members, [k, -slot.max]],
      lower: Number.NEGATIVE_INFINITY,
      upper: 0,
    });
  });

  for (const indices of slotsByProject.values()) {
    for (let t = 0; t + 1 < indices.length; t++) {
      rows.push({
        entries: [
          [indices[t], 1],
          [indices[t + 1], -1],
        ],
        lower: 0,
        upper: Number.POSITIVE_INFINITY,
      });
    }
  }

  const eligibleCount = new Map<string, number>();
  const pinnedCount = new Map<string, number>();
  eligibleByStudent.forEach((eligible, s) => {
    for (const p of eligible) {
      increment(eligibleCount, p.key);
    }
    const pin = students[s].pin;
    if (pin !== undefined) {
      increment(pinnedCount, pin);
    }
  });

  const projectsBelowMin: string[] = [];
  const pinOverflow: PlacementDiagnostics["pinOverflow"] = [];
  let seats = 0;
  let requiredSeats = 0;
  for (const project of active) {
    const { min, max } = bounds(project);
    const projectSeats = project.maxTeams * max;
    seats += projectSeats;
    const pinned = pinnedCount.get(project.key) ?? 0;
    if ((eligibleCount.get(project.key) ?? 0) < min) {
      projectsBelowMin.push(project.key);
    } else if (parameters.requireOneTeamPerProject) {
      requiredSeats += min;
      rows.push({
        entries: (slotsByProject.get(project.key) ?? []).map((k) => [k, 1]),
        lower: 1,
        upper: Number.POSITIVE_INFINITY,
      });
    }
    if (pinned > projectSeats) {
      pinOverflow.push({
        projectKey: project.key,
        pinned,
        seats: projectSeats,
      });
    }
  }

  return {
    columns,
    rows,
    slots,
    students,
    unplaced,
    diagnostics: {
      seatShortfall:
        students.length > seats ? { students: students.length, seats } : null,
      projectsBelowMin,
      requiredSeatShortfall:
        requiredSeats > students.length
          ? { required: requiredSeats, students: students.length }
          : null,
      pinnedProjectsBelowMin: projectsBelowMin.filter(
        (key) => (pinnedCount.get(key) ?? 0) > 0
      ),
      pinOverflow,
    },
  };
}

function increment(counts: Map<string, number>, key: string) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

/**
 * Which projects each student may join. A pin narrows a student to the pinned
 * project whether or not they bid on it; otherwise a student may join the
 * projects they bid on, or every project with `allowUnranked`. A student left
 * with none is unplaced here rather than making the whole model infeasible.
 */
function resolveEligibility(
  input: PlacementInput,
  active: PlacementProject[]
): {
  eligibleByStudent: PlacementProject[][];
  students: PlacementStudent[];
  unplaced: Unplaced[];
} {
  const activeByKey = new Map(active.map((p) => [p.key, p]));
  const unplaced: Unplaced[] = [];
  const students: PlacementStudent[] = [];
  const eligibleByStudent: PlacementProject[][] = [];
  for (const student of input.students) {
    const eligible = eligibleProjects(
      student,
      active,
      activeByKey,
      input.parameters.allowUnranked
    );
    if (eligible.length === 0) {
      unplaced.push({
        email: student.email,
        reason:
          student.pin === undefined
            ? "no_eligible_project"
            : "pinned_to_dropped_project",
      });
      continue;
    }
    students.push(student);
    eligibleByStudent.push(eligible);
  }
  return { students, eligibleByStudent, unplaced };
}

function eligibleProjects(
  student: PlacementStudent,
  active: PlacementProject[],
  activeByKey: Map<string, PlacementProject>,
  allowUnranked: boolean
): PlacementProject[] {
  if (student.pin !== undefined) {
    const pinned = activeByKey.get(student.pin);
    return pinned === undefined ? [] : [pinned];
  }
  if (allowUnranked) {
    return active;
  }
  const bidOn = new Set(student.bids.map((b) => b.projectKey));
  return active.filter((p) => bidOn.has(p.key));
}
