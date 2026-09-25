/**
 * The placement solver's inputs and outputs. Everything here lives in the
 * staff member's browser and never reaches the server (ADR-0056), which is
 * why none of it has a wire schema.
 */

export interface PlacementProject {
  /** Stable within one workspace: a project id from the portal, or the
   * normalized title for a project from a CSV. */
  key: string;
  /** Overrides the page default when set. */
  maxStudents?: number;
  /** A ceiling, not a target. 0 leaves the project out of placement. */
  maxTeams: number;
  /** Overrides the page default when set. */
  minStudents?: number;
  title: string;
  /** Scales every bid weight on this project; 1 leaves it alone. */
  weightMultiplier: number;
}

/**
 * A project as the workspace holds it: a blank max teams means the page
 * default, resolved when a run starts, so changing the default reaches every
 * project that never set its own.
 */
export type WorkspaceProject = Omit<PlacementProject, "maxTeams"> & {
  maxTeams?: number;
};

export interface PlacementBid {
  comment: string;
  /** 1 for the student's first choice. */
  priority: number;
  projectKey: string;
}

export interface PlacementStudent {
  /** The "prefer not to work with" answer, carried through untouched. */
  avoid?: string;
  bids: PlacementBid[];
  /** Lowercased; the key. */
  email: string;
  name: string;
  /** The project key this student is pinned to, if any. */
  pin?: string;
}

export interface PlacementParameters {
  /** Let the solver place a student on a project they did not bid on, at
   * weight 0. */
  allowUnranked: boolean;
  maxStudents: number;
  minStudents: number;
  /** Weight of a bid by priority: index 0 is priority 1. A priority past the
   * end weighs 0. */
  rankWeights: number[];
  /** Every project whose eligible students reach its minimum forms at least
   * one team. */
  requireOneTeamPerProject: boolean;
  timeLimitSeconds: number;
}

export const DEFAULT_PLACEMENT_PARAMETERS: PlacementParameters = {
  rankWeights: [100, 85, 75, 70],
  minStudents: 3,
  maxStudents: 4,
  allowUnranked: false,
  requireOneTeamPerProject: true,
  timeLimitSeconds: 30,
};

export interface PlacementInput {
  parameters: PlacementParameters;
  projects: PlacementProject[];
  students: PlacementStudent[];
}

export interface Placement {
  email: string;
  /** The priority the student gave this project, or null for a pin or an
   * unranked placement outside their bids. */
  priority: number | null;
  projectKey: string;
  /** 1-based, within the project. */
  team: number;
}

export type UnplacedReason =
  | "no_eligible_project"
  | "pinned_to_dropped_project";

export interface Unplaced {
  email: string;
  reason: UnplacedReason;
}

/** Why a run might be infeasible or partial, found before solving. */
export interface PlacementDiagnostics {
  /** Projects in `projectsBelowMin` that a student is pinned to, which makes
   * the run infeasible. */
  pinnedProjectsBelowMin: string[];
  /** Projects with more pinned students than seats. */
  pinOverflow: { projectKey: string; pinned: number; seats: number }[];
  /** Projects whose eligible students cannot reach the project's minimum,
   * so they can form no team. Exempt from the at-least-one-team rule. */
  projectsBelowMin: string[];
  /** The at-least-one-team rule asks each project it binds for its minimum,
   * and together those exceed the students who can be placed. Catches the
   * common way the rule makes a run infeasible, not every way. */
  requiredSeatShortfall: { required: number; students: number } | null;
  /** Students who can be placed, and every seat at every project's max. */
  seatShortfall: { students: number; seats: number } | null;
}

export type PlacementStatus = "optimal" | "time_limit" | "infeasible" | "error";

export interface PlacementResult {
  diagnostics: PlacementDiagnostics;
  /** The relative optimality gap when the time limit stopped the run. */
  gap: number | null;
  /** The solver's own words, for a status of "error". */
  message?: string;
  objective: number | null;
  placements: Placement[];
  status: PlacementStatus;
  unplaced: Unplaced[];
}
