export type Status =
  | "draft"
  | "submitted"
  | "approved"
  | "changes_requested"
  | "published"
  | "archived";

export type ActorRole = "owner" | "staff";

const TRANSITIONS: Record<Status, Partial<Record<ActorRole, Status[]>>> = {
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
  from: Status,
  to: Status,
  role: ActorRole
): boolean {
  return (TRANSITIONS[from][role] ?? []).includes(to);
}

export function assertTransitionAllowed(
  from: Status,
  to: Status,
  role: ActorRole
): void {
  if (!canTransition(from, to, role)) {
    throw new Error(`Transition ${from} -> ${to} not allowed for ${role}`);
  }
}
