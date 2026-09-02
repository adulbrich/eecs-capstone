// `isStaff` and `Viewer` live in `src/lib/viewer.ts`. They answer questions
// about a viewer's role, not about a project, and seven non-project domains
// were importing them through this module. Consumers import them from there
// directly rather than through a re-export here, which Biome forbids as a
// barrel and which the project's no-shims rule would reject anyway.

import type { Status } from "./project-workflow";
import type { Viewer } from "./viewer";
import { isStaff } from "./viewer";

/**
 * What every predicate below actually reads. Deliberately not "a project row":
 * a caller that only needs to know whether a viewer may see something should
 * not have to select columns nobody looks at. `notes` used to be here and is
 * now on `ProjectRow`, which is the one shape that reads it, so a listing can
 * run `canSeeProject` without pulling a staff-only column it would then have to
 * remember to drop.
 */
export type VisibleProject = {
  id: string;
  proposerId: string | null;
  status: string;
  deletedAt: Date | null;
} & Record<string, unknown>;

export type VisibleComment = {
  isInternal: boolean | null;
} & Record<string, unknown>;

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

/** The columns the projection reads, named structurally rather than by import. */
export interface ProjectRow extends VisibleProject {
  contactEmail: string | null;
  contactName: string | null;
  description: string | null;
  imageUrl: string | null;
  isSponsored: boolean;
  licenseRestrictions: string | null;
  mentorEmail: string | null;
  mentorName: string | null;
  minQualifications: string | null;
  notes: string | null;
  objectives: string | null;
  prefQualifications: string | null;
  problemStatement: string | null;
  programId: string | null;
  requiresNdaIp: boolean;
  seekingMentor: boolean;
  studentProposed: boolean;
  teamsSupported: number;
  title: string;
  url: string | null;
}

export interface ProjectDetailView {
  contactEmail: string | null;
  contactName: string | null;
  deletedAt: Date | null;
  description: string | null;
  id: string;
  imageUrl: string | null;
  /** Staff and the proposer see the value; everyone else sees null. */
  isSponsored: boolean | null;
  licenseRestrictions: string | null;
  /** The resolved account's name. Null when unset or when nobody has signed up at that address. */
  mentorName: string | null;
  minQualifications: string | null;
  notes: string | null;
  objectives: string | null;
  prefQualifications: string | null;
  problemStatement: string | null;
  programId: string | null;
  requiresNdaIp: boolean;
  /** `studentProposed` with no mentor address on file. Derived in SQL, never stored. */
  seekingMentor: boolean;
  status: Status;
  studentProposed: boolean;
  teamsSupported: number;
  title: string;
  url: string | null;
}

/**
 * What the project detail and edit pages may read.
 *
 * `/projects/$id` is public, so this payload reaches anonymous viewers. Every
 * field is named here, which is the property worth keeping: adding a column to
 * `projects` cannot leak through it, because nothing copies the row wholesale.
 *
 * Before this the rule lived in two places. `stripPrivateFields` nulled two
 * columns and the caller patched three more inline, which is what a fix looks
 * like when someone finds a leak at the call site instead of in the module.
 *
 * `proposerEmail` is absent rather than nulled. Nothing reads it here, and the
 * staff panel gets the proposer through `getProposerForEditAs`, which is
 * staff-gated at the server rather than made safe by an assignment.
 */
export function projectDetailView(
  project: ProjectRow,
  viewer: Viewer
): ProjectDetailView {
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    problemStatement: project.problemStatement,
    objectives: project.objectives,
    minQualifications: project.minQualifications,
    prefQualifications: project.prefQualifications,
    url: project.url,
    contactEmail: project.contactEmail,
    contactName: project.contactName,
    imageUrl: project.imageUrl,
    licenseRestrictions: project.licenseRestrictions,
    // Public by design: a student needs to know an agreement is involved
    // before bidding, and this is what a catalog filter would key on.
    requiresNdaIp: project.requiresNdaIp,
    teamsSupported: project.teamsSupported,
    programId: project.programId,
    status: project.status as Status,
    deletedAt: project.deletedAt,
    // The one viewer-dependent field, and the reason this cannot be a SQL
    // column map: the rule is which columns for THIS viewer, not which columns.
    notes: canSeePrivateNotes(project, viewer) ? project.notes : null,
    // Same audience as the private notes: staff and the proposer. Sponsorship
    // is closer to a funding conversation than a project attribute, so it
    // does not reach the public payload. Nulled rather than omitted, because
    // this projection returns one fixed key set for every viewer and
    // project-visibility.test.ts pins that. The proposer is included because
    // they declare it on the form: hide it from them and an edit round-trip
    // would silently reset the flag.
    isSponsored: canSeePrivateNotes(project, viewer)
      ? project.isSponsored
      : null,
    // Public by design, all three: the marker a student browsing the catalog
    // is looking for, and the mentor as a name only. `mentorEmail` is not
    // named here and must not be. It is an address staff typed, which the
    // person may never have chosen to publish, and it stays on the staff read
    // in projects-queries.ts. See #75.
    studentProposed: project.studentProposed,
    seekingMentor: project.seekingMentor,
    mentorName: project.mentorName,
  };
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
