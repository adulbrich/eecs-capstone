import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "#/db";
import { programs, projectBookmarks, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { canSeeProject } from "#/lib/project-visibility";
import type { Viewer } from "#/lib/viewer";
import { projectSummarySelect } from "./project-summary";

/**
 * `*As` first, `*ForCurrentUser` second, per the workflow conventions in
 * `docs/QUIRKS.md`.
 *
 * This module used to have only the second half, and the cost showed up in its
 * tests: `requireUser()` cannot run under the integration suite, so the two
 * cases in `bookmarks.integration.test.ts` inserted rows directly and one of
 * them re-implemented the very join it asserted on. The authorization check in
 * `addBookmarkAs` had no coverage at all.
 */

/** Not null: every one of these paths runs for a signed-in viewer. */
type BookmarkViewer = NonNullable<Viewer>;

export async function addBookmarkAs(
  viewer: BookmarkViewer,
  data: { projectId: string }
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  // You cannot bookmark what you cannot see. Without this, a draft or
  // soft-deleted project id guessed from anywhere would be bookmarkable, and
  // the listing joins the project back in.
  if (!canSeeProject(project, { id: viewer.id, role: viewer.role ?? null })) {
    throw new Error("Forbidden");
  }
  await db
    .insert(projectBookmarks)
    .values({ userId: viewer.id, projectId: data.projectId })
    .onConflictDoNothing();
  return { ok: true };
}

export async function removeBookmarkAs(
  viewer: BookmarkViewer,
  data: { projectId: string }
) {
  // Scoped to the viewer, so the id alone cannot remove someone else's.
  await db
    .delete(projectBookmarks)
    .where(
      and(
        eq(projectBookmarks.userId, viewer.id),
        eq(projectBookmarks.projectId, data.projectId)
      )
    );
  return { ok: true };
}

export async function isBookmarkedAs(
  viewer: BookmarkViewer,
  data: { projectId: string }
) {
  const [row] = await db
    .select({ projectId: projectBookmarks.projectId })
    .from(projectBookmarks)
    .where(
      and(
        eq(projectBookmarks.userId, viewer.id),
        eq(projectBookmarks.projectId, data.projectId)
      )
    );
  return { bookmarked: !!row };
}

/**
 * `addBookmarkAs` gates on `canSeeProject`, and this re-runs it on read. Without
 * the second check the row is a permanent capability: a project published when
 * a student saved it and later pushed back to `changes_requested` keeps
 * rendering for them, description and all, long after staff pulled it. Not a
 * guessed-id leak, which the write gate stops, but a stale authorization.
 *
 * `canSeeProject` rather than a status list, because the same call keeps a
 * proposer's own unpublished bookmark visible to them, which a list of allowed
 * statuses would wrongly hide. Same argument as `filterCommentsForViewer`: one
 * rule in one place, not two that drift.
 *
 * The bookmark row survives, so a project that is republished comes back.
 */
export async function listMyBookmarksAs(viewer: BookmarkViewer) {
  const rows = await db
    .select({
      ...projectSummarySelect,
      bookmarkedAt: projectBookmarks.createdAt,
      // Read by canSeeProject below, then dropped. proposerId is what decides
      // ownership and is staff information; deletedAt is a machine column.
      // Neither belongs in the payload, and projectSummarySelect omits both.
      deletedAt: projects.deletedAt,
      proposerId: projects.proposerId,
    })
    .from(projectBookmarks)
    .innerJoin(projects, eq(projectBookmarks.projectId, projects.id))
    .leftJoin(programs, eq(projects.programId, programs.id))
    // A project soft-deleted after it was bookmarked drops out of the listing
    // rather than rendering as a dead row. Kept in SQL rather than left to
    // canSeeProject, which returns true for staff on a deleted project: a dead
    // row is no more useful to staff than to anyone else on their own shortlist.
    .where(
      and(eq(projectBookmarks.userId, viewer.id), isNull(projects.deletedAt))
    )
    .orderBy(desc(projectBookmarks.createdAt));

  return {
    rows: rows
      .filter((row) => canSeeProject(row, viewer))
      .map(({ deletedAt, proposerId, ...row }) => row),
  };
}

export async function addBookmarkForCurrentUser(data: { projectId: string }) {
  const viewer = await requireUser();
  return addBookmarkAs(viewer, data);
}

export async function removeBookmarkForCurrentUser(data: {
  projectId: string;
}) {
  const viewer = await requireUser();
  return removeBookmarkAs(viewer, data);
}

export async function isBookmarkedForCurrentUser(data: { projectId: string }) {
  const viewer = await requireUser();
  return isBookmarkedAs(viewer, data);
}

export async function listMyBookmarksForCurrentUser() {
  const viewer = await requireUser();
  return listMyBookmarksAs(viewer);
}
