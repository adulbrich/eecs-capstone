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
export const PROJECT_STATUS_DISPLAY_RANK: Record<ProjectStatus, number> = {
  draft: 0,
  submitted: 1,
  changes_requested: 2,
  approved: 3,
  published: 4,
  archived: 5,
};

export const PROJECT_STATUSES_IN_DISPLAY_ORDER: readonly ProjectStatus[] = [
  ...PROJECT_STATUSES,
].sort(
  (a, b) => PROJECT_STATUS_DISPLAY_RANK[a] - PROJECT_STATUS_DISPLAY_RANK[b]
);

/**
 * The one display label per status. The badge, the staff stepper, the
 * analytics chart and both status filters read this, so a status cannot be
 * "changes requested" on the card and "Changes Req." on the stepper (#303).
 * Sentence case and the glossary's spelling, `CONTEXT.md` under **Status**.
 *
 * Here and not in `status-badge.tsx` for the reason ADR-0014 gives for the
 * vocabularies: `src/lib` imports nothing, so a route filter or a server
 * module can read the label without pulling a component in. A `Record`
 * keyed by the union, so an unlabelled status fails to compile.
 */
export const PROJECT_STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: "Draft",
  submitted: "Submitted",
  changes_requested: "Changes requested",
  approved: "Approved",
  published: "Published",
  archived: "Archived",
};

/**
 * What each status means, in the reader's words, for the places that explain
 * a status rather than name it: the staff stepper and the proposer's actions
 * block. The public badge names and does not explain (#303 decided against a
 * tooltip there). The wording is the glossary's, with "you" for the proposer
 * where the glossary says "the proposer", because both surfaces address the
 * person acting on the project.
 */
export const PROJECT_STATUS_DESCRIPTION: Record<ProjectStatus, string> = {
  draft:
    "Written and not yet handed to staff. Only the proposer and staff can see it.",
  submitted: "Handed to staff for review.",
  changes_requested:
    "Staff sent it back with a note. The proposer edits and resubmits.",
  approved:
    "Accepted by staff and not yet published. Only the proposer and staff can see it.",
  published: "In the public catalog.",
  archived:
    "Out of the catalog's default view. Still reachable by its link and through the archived filter, and staff can republish it.",
};
