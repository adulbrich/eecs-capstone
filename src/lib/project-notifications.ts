/**
 * Who receives a project notification, and what it says.
 *
 * Pure and client-safe, the same shape `inventory-notifications.ts` already
 * has and for the same reason: the decision used to be welded to the
 * `tx.insert` in `src/server/_internal/notify.ts`, so the only way to ask
 * "does the proposer get told when staff move their own project" was a full
 * request lifecycle against docker Postgres.
 *
 * The transaction's job is the insert. This module's job is the choice.
 *
 * Every string here moved verbatim from `notify.ts`. Rewording any of them is
 * a separate change with its own reason, not a side effect of this one.
 */

import type { NotificationRow } from "./notification-row";
import type { ProjectStatus } from "./vocabularies";

/** The parts of a project these decisions read. */
export interface NotifiableProject {
  id: string;
  proposerId: string | null;
  title: string;
}

/** The parts of a comment these decisions read. */
export interface NotifiableComment {
  authorId: string;
  content: string;
  id: string;
  isInternal: boolean | null;
  parentId: string | null;
}

/**
 * The proposer, unless there is none or they are the one who acted.
 *
 * Both single-recipient decisions below open with this, which is the whole of
 * the "silence" rule they share: staff moving somebody else's project notifies
 * that person, and a proposer moving their own project notifies nobody,
 * because the only person to tell is the one who just clicked the button.
 */
function proposerToTell(
  project: NotifiableProject,
  actorId: string
): string | null {
  if (!project.proposerId || project.proposerId === actorId) {
    return null;
  }
  return project.proposerId;
}

/** The notice a status change owes the proposer, or none. */
export function statusChangeNotification(
  project: NotifiableProject,
  newStatus: ProjectStatus,
  actorId: string,
  comment?: string | null
): NotificationRow | null {
  const userId = proposerToTell(project, actorId);
  if (!userId) {
    return null;
  }
  const changesRequested = newStatus === "changes_requested";
  const trimmed = comment?.trim();
  return {
    userId,
    type: "status_change",
    title: changesRequested
      ? `Changes requested on '${project.title}'`
      : `Your project '${project.title}' is now ${newStatus}`,
    message:
      changesRequested && trimmed
        ? `Changes requested: ${trimmed}`
        : `Status changed to ${newStatus}.`,
    link: `/projects/${project.id}`,
  };
}

/** The notice a soft delete, restore or hard delete owes the proposer. */
export function softDeleteNotification(
  project: NotifiableProject,
  action: "soft-deleted" | "restored" | "hard-deleted",
  actorId: string
): NotificationRow | null {
  const userId = proposerToTell(project, actorId);
  if (!userId) {
    return null;
  }
  return {
    userId,
    type: "soft_delete",
    title: `Your project '${project.title}' was ${action} by staff`,
    message: `Staff performed: ${action}.`,
    link: `/projects/${project.id}`,
  };
}

/**
 * The notices a comment owes, deduped, in insertion order.
 *
 * `parentAuthorId` is a parameter rather than something this module looks up,
 * which is the seam: finding the parent comment's author is a `tx.select`, so
 * it stays in `notify.ts` and only its answer crosses into the decision. Pass
 * `null` when the comment is a root comment, or when the parent could not be
 * found on this project.
 *
 * Returns many rather than one, because a reply notifies the proposer and the
 * parent's author both, and a `Set` is what stops the proposer replying to
 * their own thread from being told twice.
 */
export function commentNotifications(
  project: NotifiableProject,
  comment: NotifiableComment,
  parentAuthorId: string | null
): NotificationRow[] {
  // An internal comment is staff talking among themselves, so nobody outside
  // that conversation hears about it. Checked before recipients are gathered,
  // not after, so no branch below has to remember it.
  if (comment.isInternal) {
    return [];
  }

  const recipients = new Set<string>();
  if (project.proposerId && comment.authorId !== project.proposerId) {
    recipients.add(project.proposerId);
  }
  if (parentAuthorId && parentAuthorId !== comment.authorId) {
    recipients.add(parentAuthorId);
  }

  return [...recipients].map((userId) => ({
    userId,
    type: "comment",
    title: `New comment on '${project.title}'`,
    message: comment.content.slice(0, 200),
    link: `/projects/${project.id}#comment-${comment.id}`,
  }));
}
