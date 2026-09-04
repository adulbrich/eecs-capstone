import { PROJECT_STATUSES, type ProjectStatus } from "./vocabularies";

export type ActorRole = "owner" | "staff";

const TRANSITIONS: Record<
  ProjectStatus,
  Partial<Record<ActorRole, ProjectStatus[]>>
> = {
  draft: {
    owner: ["submitted"],
    staff: ["submitted", "approved"],
  },
  submitted: {
    owner: ["draft"],
    staff: ["draft", "approved", "changes_requested"],
  },
  changes_requested: {
    owner: ["submitted"],
    staff: ["submitted", "approved"],
  },
  approved: {
    staff: ["published", "changes_requested"],
  },
  published: {
    staff: ["archived"],
  },
  archived: {
    staff: ["published"],
  },
};

export function canTransition(
  from: ProjectStatus,
  to: ProjectStatus,
  role: ActorRole
): boolean {
  return (TRANSITIONS[from][role] ?? []).includes(to);
}

export function assertTransitionAllowed(
  from: ProjectStatus,
  to: ProjectStatus,
  role: ActorRole
): void {
  if (!canTransition(from, to, role)) {
    throw new Error(`Transition ${from} -> ${to} not allowed for ${role}`);
  }
}

/**
 * The order a reader is shown the statuses in, which is not the vocabulary's.
 * This reads `changes_requested` as the step back out of `submitted` and puts
 * it beside it, where the tuple lists the two outcomes of a review the other
 * way round. The staff stepper and the analytics breakdown both draw this.
 *
 * The ranks live in a `Record` keyed by the union, so a status added to the
 * vocabulary and left unranked fails to compile rather than quietly going
 * missing from a stepper or a chart.
 */
const DISPLAY_RANK: Record<ProjectStatus, number> = {
  draft: 0,
  submitted: 1,
  changes_requested: 2,
  approved: 3,
  published: 4,
  archived: 5,
};

export const PROJECT_STATUSES_IN_DISPLAY_ORDER: readonly ProjectStatus[] = [
  ...PROJECT_STATUSES,
].sort((a, b) => DISPLAY_RANK[a] - DISPLAY_RANK[b]);
