import { and, eq } from "drizzle-orm";
import type { db as Db } from "#/db";
import { notifications, projectComments } from "#/db/schema";
import {
  commentNotifications,
  type NotifiableComment,
  type NotifiableProject,
  softDeleteNotification,
  statusChangeNotification,
} from "#/lib/project-notifications";
import type { Status } from "#/lib/project-workflow";

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

export async function recordStatusChangeNotifications(
  tx: Tx,
  project: NotifiableProject,
  newStatus: Status,
  actorId: string,
  comment?: string | null
): Promise<void> {
  const row = statusChangeNotification(project, newStatus, actorId, comment);
  if (row) {
    await tx.insert(notifications).values(row);
  }
}

export async function recordSoftDeleteNotification(
  tx: Tx,
  project: NotifiableProject,
  action: "soft-deleted" | "restored" | "hard-deleted",
  actorId: string
): Promise<void> {
  const row = softDeleteNotification(project, action, actorId);
  if (row) {
    await tx.insert(notifications).values(row);
  }
}

export async function recordCommentNotifications(
  tx: Tx,
  project: NotifiableProject,
  comment: NotifiableComment
): Promise<void> {
  // The one read the decision cannot make for itself, so it happens here and
  // only its answer crosses the seam. Scoped to this project as well as to the
  // id, so a parent id belonging to another project resolves to nobody rather
  // than notifying a stranger.
  //
  // `isInternal` is tested here as well as inside the decision, which is not a
  // duplicated rule so much as the reason this query is skippable: an internal
  // comment tells nobody, so looking up who to tell is work with no reader.
  // The decision keeps its own copy because it must be correct when called
  // directly, as the unit tests call it.
  let parentAuthorId: string | null = null;
  if (comment.parentId && !comment.isInternal) {
    const [parent] = await tx
      .select({ authorId: projectComments.authorId })
      .from(projectComments)
      .where(
        and(
          eq(projectComments.id, comment.parentId),
          eq(projectComments.projectId, project.id)
        )
      );
    parentAuthorId = parent?.authorId ?? null;
  }

  for (const row of commentNotifications(project, comment, parentAuthorId)) {
    await tx.insert(notifications).values(row);
  }
}
