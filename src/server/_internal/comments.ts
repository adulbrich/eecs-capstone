import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { projectComments, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { isStaff } from "#/lib/project-visibility";
import type { AddCommentInput } from "../comments";
import { recordCommentNotifications } from "./notify";

export interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

export async function addCommentAs(
  viewer: AuthUser,
  data: AddCommentInput
): Promise<{ id: string }> {
  const visibility = { id: viewer.id, role: viewer.role ?? null };
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  // Comments are a private submitter <-> staff dialogue, so only the project
  // submitter and staff may participate.
  const isOwner = project.proposerId === viewer.id;
  if (!(isStaff(visibility) || isOwner)) {
    throw new Error("Forbidden");
  }
  if (data.isInternal && !isStaff(visibility)) {
    throw new Error("Only staff may post internal comments");
  }
  if (data.parentId) {
    const [parent] = await db
      .select()
      .from(projectComments)
      .where(
        and(
          eq(projectComments.id, data.parentId),
          eq(projectComments.projectId, data.projectId)
        )
      );
    if (!parent) {
      throw new Error("Parent comment not found on this project");
    }
    if (parent.parentId) {
      throw new Error("Replies are one level deep");
    }
  }

  let createdId = "";
  await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(projectComments)
      .values({
        projectId: data.projectId,
        authorId: viewer.id,
        parentId: data.parentId ?? null,
        content: data.content,
        isInternal: data.isInternal,
      })
      .returning();
    createdId = row.id;
    await recordCommentNotifications(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      {
        id: row.id,
        projectId: row.projectId,
        authorId: row.authorId,
        parentId: row.parentId,
        isInternal: row.isInternal,
        content: row.content,
      }
    );
  });
  return { id: createdId };
}

export async function addCommentForCurrentUser(data: AddCommentInput) {
  const viewer = await requireUser();
  return addCommentAs(viewer, data);
}
