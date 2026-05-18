import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "#/db";
import { projectBookmarks, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { canSeeProject } from "#/lib/project-visibility";

export async function addBookmarkForCurrentUser(data: { projectId: string }) {
  const viewer = await requireUser();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) throw new Error("Project not found");
  if (!canSeeProject(project, { id: viewer.id, role: viewer.role ?? null })) {
    throw new Error("Forbidden");
  }
  await db
    .insert(projectBookmarks)
    .values({ userId: viewer.id, projectId: data.projectId })
    .onConflictDoNothing();
  return { ok: true };
}

export async function removeBookmarkForCurrentUser(data: {
  projectId: string;
}) {
  const viewer = await requireUser();
  await db
    .delete(projectBookmarks)
    .where(
      and(
        eq(projectBookmarks.userId, viewer.id),
        eq(projectBookmarks.projectId, data.projectId),
      ),
    );
  return { ok: true };
}

export async function isBookmarkedForCurrentUser(data: { projectId: string }) {
  const viewer = await requireUser();
  const [row] = await db
    .select({ projectId: projectBookmarks.projectId })
    .from(projectBookmarks)
    .where(
      and(
        eq(projectBookmarks.userId, viewer.id),
        eq(projectBookmarks.projectId, data.projectId),
      ),
    );
  return { bookmarked: !!row };
}

export async function listMyBookmarksForCurrentUser() {
  const viewer = await requireUser();
  const rows = await db
    .select({
      id: projects.id,
      title: projects.title,
      description: projects.description,
      status: projects.status,
      publishedAt: projects.publishedAt,
      proposerId: projects.proposerId,
      bookmarkedAt: projectBookmarks.createdAt,
    })
    .from(projectBookmarks)
    .innerJoin(projects, eq(projectBookmarks.projectId, projects.id))
    .where(
      and(eq(projectBookmarks.userId, viewer.id), isNull(projects.deletedAt)),
    )
    .orderBy(desc(projectBookmarks.createdAt));
  return { rows };
}
