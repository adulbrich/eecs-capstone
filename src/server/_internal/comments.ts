import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { projectComments, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { isStaff } from "#/lib/viewer";
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
  if (!(isStaff(viewer) || isOwner)) {
    throw new Error("Forbidden");
  }
  // Checked against the caller's own flag, before any inheritance below, so a
  // non-staff caller cannot smuggle an internal comment in via a parentId.
  if (data.isInternal && !isStaff(viewer)) {
    throw new Error("Only staff may post internal comments");
  }
  let isInternal = data.isInternal;
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
    // An internal thread stays internal all the way down: a reply that quoted
    // its internal parent would otherwise expose that parent's substance to
    // the proposer. The converse is deliberately not true, so staff can still
    // start an internal side-thread under a comment the proposer can see.
    if (parent.isInternal) {
      isInternal = true;
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
        isInternal,
      })
      .returning();
    createdId = row.id;
    await recordCommentNotifications(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      {
        id: row.id,
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
