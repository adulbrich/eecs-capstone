export type Viewer =
  | { id: string; role: string | null | undefined }
  | null
  | undefined;

export type VisibleProject = {
  id: string;
  proposerId: string;
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
  return project.status === "published";
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

export function stripStaffOnlyFields<T extends VisibleProject>(
  project: T,
  viewer: Viewer
): T {
  if (isStaff(viewer)) {
    return project;
  }
  return { ...project, notes: null };
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
