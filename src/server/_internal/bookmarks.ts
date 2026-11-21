import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { projectBookmarks, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { canSeeProject } from "#/lib/project-visibility";
import type { Viewer } from "#/lib/viewer";
import {
  projectSummarySelect,
  runsInProgram,
  withExcerpt,
} from "./project-summary";

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
  if (!canSeeProject(project, viewer)) {
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
 *
 * `unavailableCount` is how many the filter removed. The page shows it as one
 * quiet line, because a list that silently got shorter reads as a lost
 * bookmark; the number reveals nothing the viewer did not save themselves.
 * Soft-deleted projects are not in it: the SQL above drops those for every
 * viewer, and a project that is gone is not "not currently available".
 */
export async function listMyBookmarksAs(viewer: BookmarkViewer) {
  const rows = await db
    .select({
      ...projectSummarySelect,
      bookmarkedAt: projectBookmarks.createdAt,
      // Selected for canSeeProject below, then dropped: proposerId decides
      // ownership and is staff information, and neither belongs in the payload.
      // deletedAt is always null here, since the where clause already excluded
      // the rest; it is selected to satisfy the check honestly rather than to
      // decide anything.
      deletedAt: projects.deletedAt,
      proposerId: projects.proposerId,
    })
    .from(projectBookmarks)
    .innerJoin(projects, eq(projectBookmarks.projectId, projects.id))
    // A project soft-deleted after it was bookmarked drops out of the listing
    // rather than rendering as a dead row. Kept in SQL rather than left to
    // canSeeProject, which returns true for staff on a deleted project: a dead
    // row is no more useful to staff than to anyone else on their own shortlist.
    .where(
      and(eq(projectBookmarks.userId, viewer.id), isNull(projects.deletedAt))
    )
    .orderBy(desc(projectBookmarks.createdAt));

  const visible = rows.filter((row) => canSeeProject(row, viewer));
  return {
    rows: visible.map(({ deletedAt, proposerId, ...row }) => withExcerpt(row)),
    unavailableCount: rows.length - visible.length,
  };
}

/**
 * The project ids the viewer has bookmarked, for a listing that renders a
 * toggle per row and wants one request rather than one per row.
 *
 * No `canSeeProject` pass, unlike `listMyBookmarksAs`: nothing about the
 * project is returned, and a listing only ever matches these ids against rows
 * it already showed, so an id for a project the viewer can no longer see
 * matches nothing and decides nothing.
 */
export async function listMyBookmarkIdsAs(viewer: BookmarkViewer) {
  const rows = await db
    .select({ projectId: projectBookmarks.projectId })
    .from(projectBookmarks)
    .where(eq(projectBookmarks.userId, viewer.id));
  return { ids: rows.map((row) => row.projectId) };
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

export async function listMyBookmarkIdsForCurrentUser() {
  const viewer = await requireUser();
  return listMyBookmarkIdsAs(viewer);
}

/**
 * When a bookmark counts as interest in a published project: made at or
 * after its publication, or always when `published_at` is null. Since
 * publication rather than ever, so a project is not credited with the
 * bookmarks staff made on its draft in review. The one statement of the
 * rule, read only through `bookmarksPerProject`.
 */
const countsSincePublication = sql`(${projects.publishedAt} is null or ${projectBookmarks.createdAt} >= ${projects.publishedAt})`;

/**
 * Every published project in scope with its bookmarks since publication. A
 * left join, with the rule in its `on`, so a project nobody bookmarked keeps
 * its row at zero; counted on a bookmark column, not `count(*)`, which would
 * give that row a one.
 *
 * Two readers, one query: the staff tables on `/admin/analytics` scope it by
 * program (#518), and the project page's public badge by id (#906). So a
 * project's count on its page is its row in the table, and a project that is
 * not published, or is soft-deleted, has neither. The program scope is the
 * table's alone: a project outside the selected program keeps its badge.
 */
export function bookmarksPerProject(scope: {
  programId?: string | null;
  projectId?: string;
}) {
  return db
    .select({
      id: projects.id,
      title: projects.title,
      teamsSupported: projects.teamsSupported,
      bookmarks: sql<number>`count(${projectBookmarks.userId})::int`.as(
        "bookmarks"
      ),
    })
    .from(projects)
    .leftJoin(
      projectBookmarks,
      and(eq(projectBookmarks.projectId, projects.id), countsSincePublication)
    )
    .where(
      and(
        isNull(projects.deletedAt),
        eq(projects.status, "published"),
        scope.programId ? runsInProgram(scope.programId) : undefined,
        // Against undefined, not truthiness: an empty id reaches Postgres and
        // fails as a uuid there, rather than falling through to every project
        // and answering another project's count.
        scope.projectId === undefined
          ? undefined
          : eq(projects.id, scope.projectId)
      )
    )
    .groupBy(projects.id);
}

/**
 * A project's public bookmark count (#906): its row of the staff table, or
 * null when it has none, which is every project that is not published or
 * is soft-deleted. Public at any value, zero included (ADR-0072).
 */
export async function projectBookmarkCount(
  projectId: string
): Promise<number | null> {
  const [row] = await bookmarksPerProject({ projectId });
  return row?.bookmarks ?? null;
}
