export type Viewer =
  | { id: string; role: string | null | undefined }
  | null
  | undefined;

export type VisibleProject = {
  id: string;
  proposerId: string | null;
  status: string;
  deletedAt: Date | null;
  notes: string | null;
} & Record<string, unknown>;

export type VisibleComment = {
  isInternal: boolean | null;
} & Record<string, unknown>;

export function isStaff(viewer: Viewer): boolean {
  if (!viewer) {
    return false;
  }
  return viewer.role === "admin" || viewer.role === "instructor";
}

function isOwner(project: VisibleProject, viewer: Viewer): boolean {
  return !!viewer && project.proposerId === viewer.id;
}

export function canSeeProject(
  project: VisibleProject,
  viewer: Viewer
): boolean {
  if (isStaff(viewer)) {
    return true;
  }
  if (project.deletedAt) {
    return false;
  }
  if (isOwner(project, viewer)) {
    return true;
  }
  // Published and archived projects are part of the public catalog (the
  // projects list exposes both, archived via the "archived only" filter), so a
  // detail page must not 404 for a project the list linked to.
  return project.status === "published" || project.status === "archived";
}

/**
 * The status timeline (transition history and its comments) is private to the
 * people involved in the review: staff and the project's proposer. Everyone
 * else, signed in or not, sees only the public metadata and the current status.
 */
export function canSeeStatusHistory(
  project: VisibleProject,
  viewer: Viewer
): boolean {
  return isStaff(viewer) || isOwner(project, viewer);
}

export function canEditProject(
  project: VisibleProject,
  viewer: Viewer
): boolean {
  if (!viewer) {
    return false;
  }
  if (project.deletedAt) {
    return false;
  }
  if (isStaff(viewer)) {
    return true;
  }
  if (!isOwner(project, viewer)) {
    return false;
  }
  return project.status !== "archived";
}

/**
 * Private notes are the proposer's and staff's shared scratchpad: submission
 * context that should never reach the public catalog, but that the proposer who
 * wrote it must still be able to read and revise. Anyone else, signed in or
 * not, never sees it.
 */
export function canSeePrivateNotes(
  project: VisibleProject,
  viewer: Viewer
): boolean {
  return isStaff(viewer) || isOwner(project, viewer);
}

/**
 * Writing private notes follows the same rule as reading them. Callers must
 * still check {@link canEditProject} first: this only answers "may this viewer
 * touch the notes field", not "may this viewer edit the project at all".
 */
export function canWritePrivateNotes(
  project: VisibleProject,
  viewer: Viewer
): boolean {
  return canSeePrivateNotes(project, viewer);
}

/**
 * Removes fields the viewer may not read. `notes` is private to staff and the
 * proposer; `proposerEmail` stays staff-only, because it identifies a third
 * party rather than describing the project.
 */
export function stripPrivateFields<T extends VisibleProject>(
  project: T,
  viewer: Viewer
): T {
  const next = { ...project };
  if (!canSeePrivateNotes(project, viewer)) {
    next.notes = null;
  }
  if (!isStaff(viewer)) {
    (next as VisibleProject).proposerEmail = null;
  }
  return next;
}

/**
 * Comments are a private dialogue between the project submitter and staff.
 * Staff see every comment; the submitter sees only non-internal comments;
 * everyone else (other signed-in users, anonymous viewers) sees none.
 */
export function filterCommentsForViewer<T extends VisibleComment>(
  comments: T[],
  viewer: Viewer,
  project: VisibleProject
): T[] {
  if (isStaff(viewer)) {
    return comments;
  }
  if (isOwner(project, viewer)) {
    return comments.filter((c) => !c.isInternal);
  }
  return [];
}
