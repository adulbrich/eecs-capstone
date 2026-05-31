import { and, eq } from "drizzle-orm";
import type { db as Db } from "#/db";
import { notifications, projectComments } from "#/db/schema";

type Tx = Parameters<Parameters<typeof Db.transaction>[0]>[0];

interface Project {
  id: string;
  proposerId: string;
  title: string;
}

interface Comment {
  authorId: string;
  content: string;
  id: string;
  isInternal: boolean | null;
  parentId: string | null;
  projectId: string;
}

export async function recordStatusChangeNotifications(
  tx: Tx,
  project: Project,
  newStatus: string,
  actorId: string
): Promise<void> {
  if (project.proposerId === actorId) {
    return;
  }
  await tx.insert(notifications).values({
    userId: project.proposerId,
    type: "status_change",
    title: `Your project '${project.title}' is now ${newStatus}`,
    message: `Status changed to ${newStatus}.`,
    link: `/projects/${project.id}`,
  });
}

export async function recordSoftDeleteNotification(
  tx: Tx,
  project: Project,
  action: "soft-deleted" | "restored" | "hard-deleted",
  actorId: string
): Promise<void> {
  if (project.proposerId === actorId) {
    return;
  }
  await tx.insert(notifications).values({
    userId: project.proposerId,
    type: "soft_delete",
    title: `Your project '${project.title}' was ${action} by staff`,
    message: `Staff performed: ${action}.`,
    link: `/projects/${project.id}`,
  });
}

export async function recordCommentNotifications(
  tx: Tx,
  project: Project,
  comment: Comment
): Promise<void> {
  if (comment.isInternal) {
    return;
  }

  const recipients = new Set<string>();
  if (comment.authorId !== project.proposerId) {
    recipients.add(project.proposerId);
  }

  if (comment.parentId) {
    const [parent] = await tx
      .select({ authorId: projectComments.authorId })
      .from(projectComments)
      .where(
        and(
          eq(projectComments.id, comment.parentId),
          eq(projectComments.projectId, project.id)
        )
      );
    if (parent && parent.authorId !== comment.authorId) {
      recipients.add(parent.authorId);
    }
  }

  for (const recipient of recipients) {
    await tx.insert(notifications).values({
      userId: recipient,
      type: "comment",
      title: `New comment on '${project.title}'`,
      message: comment.content.slice(0, 200),
      link: `/projects/${project.id}#comment-${comment.id}`,
    });
  }
}
