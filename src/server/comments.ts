import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "#/db";
import { projectComments, projects } from "#/db/schema";
import { requireUser } from "#/lib/auth-guards.server";
import { canSeeProject, isStaff } from "#/lib/project-visibility";
import { recordCommentNotifications } from "./_internal/notify";

type AuthUser = { id: string; role?: string | null | undefined };

const addCommentSchema = z.object({
  projectId: z.string().uuid(),
  content: z.string().trim().min(1).max(5000),
  parentId: z.string().uuid().nullable().optional(),
  isInternal: z.boolean().default(false),
});

export type AddCommentInput = z.infer<typeof addCommentSchema>;

export async function addCommentAs(
  viewer: AuthUser,
  data: AddCommentInput,
): Promise<{ id: string }> {
  const visibility = { id: viewer.id, role: viewer.role ?? null };
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) throw new Error("Project not found");
  if (!canSeeProject(project, visibility)) {
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
          eq(projectComments.projectId, data.projectId),
        ),
      );
    if (!parent) throw new Error("Parent comment not found on this project");
    if (parent.parentId) throw new Error("Replies are one level deep");
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
      },
    );
  });
  return { id: createdId };
}

export const addComment = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => addCommentSchema.parse(data))
  .handler(async ({ data }) => {
    const viewer = await requireUser();
    return addCommentAs(viewer, data);
  });
