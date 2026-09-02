import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNull,
  ne,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { db } from "#/db";
import {
  programs,
  projectComments,
  projectEditLog,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { readSession } from "#/lib/_internal/auth-guards";
import {
  canEditProject,
  canSeeProject,
  canSeeStatusHistory,
  filterCommentsForViewer,
  projectDetailView,
} from "#/lib/project-visibility";
import { isStaff, type Viewer } from "#/lib/viewer";
import {
  adminProjectSummarySelect,
  mentorNameSql,
  projectSummarySelect,
  seekingMentorSql,
} from "./project-summary";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type StatusFilter =
  | "all"
  | "draft"
  | "submitted"
  | "approved"
  | "changes_requested"
  | "published"
  | "archived";

type ProjectStatus = Exclude<StatusFilter, "all">;

async function getViewer(): Promise<Viewer> {
  const session = await readSession();
  return session?.user
    ? { id: session.user.id, role: session.user.role ?? null }
    : null;
}

export async function listMyProjectsImpl(data: { status: StatusFilter }) {
  const viewer = await getViewer();
  if (!viewer) {
    return { rows: [], teamCapacity: 0 };
  }
  const conditions = [
    eq(projects.proposerId, viewer.id),
    isNull(projects.deletedAt),
  ];
  if (data.status !== "all") {
    conditions.push(eq(projects.status, data.status as ProjectStatus));
  }
  const [rows, [capacity]] = await Promise.all([
    db
      .select(projectSummarySelect)
      .from(projects)
      .leftJoin(programs, eq(projects.programId, programs.id))
      .where(and(...conditions))
      .orderBy(desc(projects.updatedAt)),
    // Deliberately NOT filtered by `data.status`: this is the owner's standing
    // commitment across everything still live, so it must not move when they
    // change the status filter. Archived projects no longer take teams.
    db
      .select({
        teamCapacity: sql<number>`coalesce(sum(${projects.teamsSupported}), 0)::int`,
      })
      .from(projects)
      .where(
        and(
          eq(projects.proposerId, viewer.id),
          isNull(projects.deletedAt),
          ne(projects.status, "archived")
        )
      ),
  ]);
  return { rows, teamCapacity: capacity?.teamCapacity ?? 0 };
}

interface AdminProjectsFilter {
  includeSoftDeleted: boolean;
  program: string | null;
  proposer: string | null;
  q: string;
  status: StatusFilter;
}

/**
 * The scope the proposer dropdown is built from: status, program and the
 * soft-delete switch, but NOT the search text or the proposer choice itself.
 * Excluding the proposer keeps the option you picked from being the only one
 * left; excluding `q` keeps typing in the search box from emptying the
 * dropdown underneath you.
 */
function buildAdminProjectScope(data: AdminProjectsFilter): SQL[] {
  const scope: SQL[] = [];
  if (data.status !== "all") {
    scope.push(eq(projects.status, data.status as ProjectStatus));
  }
  if (!data.includeSoftDeleted) {
    scope.push(isNull(projects.deletedAt));
  }
  if (data.program) {
    scope.push(eq(projects.programId, data.program));
  }
  return scope;
}

/**
 * The conditions that select the listing's rows: the scope, plus the proposer
 * filter, plus the search text. The CSV export calls this too, so the file can
 * never disagree with the table about which rows match.
 */
function buildAdminProjectListConditions(data: AdminProjectsFilter): SQL[] {
  const listConditions: SQL[] = [...buildAdminProjectScope(data)];
  if (data.proposer) {
    listConditions.push(eq(projects.proposerId, data.proposer));
  }
  const trimmed = data.q.trim();
  if (trimmed) {
    // Same tsvector-plus-title-ILIKE shape as the public listing, so a
    // partial word still matches what staff hunting for a half-remembered
    // title actually type. Extended with contact and proposer fields, since
    // staff also search by who is involved, not just the text.
    const like = `%${trimmed}%`;
    const match = or(
      sql`${projects.searchVector} @@ websearch_to_tsquery('english', ${trimmed})`,
      ilike(projects.title, like),
      ilike(projects.contactName, like),
      ilike(projects.contactEmail, like),
      ilike(user.name, like),
      ilike(user.email, like)
    );
    if (match) {
      listConditions.push(match);
    }
  }
  return listConditions;
}

/**
 * Test seam. Integration tests call this directly with a viewer instead of
 * going through the request session, matching the `*As(viewer, ...)`
 * convention used by the mutation helpers.
 */
export async function listAdminProjectsAs(
  viewer: Viewer,
  data: AdminProjectsFilter
) {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const scope = buildAdminProjectScope(data);
  const listConditions = buildAdminProjectListConditions(data);

  const [rows, proposers] = await Promise.all([
    db
      .select(adminProjectSummarySelect)
      .from(projects)
      .leftJoin(programs, eq(projects.programId, programs.id))
      // Left, not inner: `proposerId` is `onDelete: "set null"`, so an inner join
      // would silently drop projects whose proposer account was removed.
      .leftJoin(user, eq(projects.proposerId, user.id))
      .where(listConditions.length ? and(...listConditions) : undefined)
      .orderBy(desc(projects.updatedAt)),
    db
      .selectDistinct({
        email: user.email,
        id: user.id,
        name: user.name,
      })
      .from(projects)
      .innerJoin(user, eq(projects.proposerId, user.id))
      .where(scope.length ? and(...scope) : undefined)
      .orderBy(asc(user.name)),
  ]);
  return { proposers, rows };
}

export async function listAdminProjectsImpl(data: AdminProjectsFilter) {
  return listAdminProjectsAs(await getViewer(), data);
}

/**
 * The staff CSV export. Same conditions and same order as the listing, no
 * pagination, and a projection widened to every meaningful column.
 *
 * `notes` is included even though it is staff-only, because this function is
 * staff-gated and an export that silently dropped the staff notes would be
 * the more surprising behavior. The gate is what makes that safe.
 */
export async function exportAdminProjectsAs(
  viewer: Viewer,
  data: AdminProjectsFilter
) {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const conditions = buildAdminProjectListConditions(data);
  const rows = await db
    .select({
      ...adminProjectSummarySelect,
      notes: projects.notes,
      archivedAt: projects.archivedAt,
    })
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .leftJoin(user, eq(projects.proposerId, user.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
  return { rows };
}

export async function exportAdminProjectsImpl(data: AdminProjectsFilter) {
  return exportAdminProjectsAs(await getViewer(), data);
}

/**
 * Test seam. Integration tests call this directly with a viewer instead of
 * going through the request session, matching the `*As(viewer, ...)`
 * convention used by the mutation helpers.
 */
export async function getProjectAs(viewer: Viewer, data: { id: string }) {
  // The row plus the two read-time mentor fields. Selected here rather than
  // joined by the view, because the view is pure and this is the only place
  // a project row is read for the detail page.
  const [row] = await db
    .select({
      project: projects,
      mentorName: mentorNameSql,
      seekingMentor: seekingMentorSql,
    })
    .from(projects)
    .where(eq(projects.id, data.id));
  const project = row
    ? {
        ...row.project,
        mentorName: row.mentorName,
        seekingMentor: row.seekingMentor,
      }
    : undefined;
  if (!project) {
    return {
      project: null,
      history: [],
      canEdit: false,
      viewerIsStaff: false,
      viewerIsOwner: false,
    };
  }
  if (!canSeeProject(project, viewer)) {
    return {
      project: null,
      history: [],
      canEdit: false,
      viewerIsStaff: false,
      viewerIsOwner: false,
    };
  }

  // Named field by field, so a new column on `projects` cannot ride this
  // payload. It matters here more than anywhere: this page is public, so the
  // object below is serialized into the SSR payload for anonymous viewers.
  // The embedding vector and search_vector are among the columns that simply
  // are not named, rather than being nulled after the fact.
  const detail = projectDetailView(project, viewer);
  // The status timeline (and its comments) is private to staff and the
  // proposer. Everyone else gets an empty history, so the field is not just
  // hidden in the UI but never leaves the server.
  const history = canSeeStatusHistory(project, viewer)
    ? await db
        .select({
          id: projectStatusHistory.id,
          oldStatus: projectStatusHistory.oldStatus,
          newStatus: projectStatusHistory.newStatus,
          changedBy: projectStatusHistory.changedBy,
          comment: projectStatusHistory.comment,
          createdAt: projectStatusHistory.createdAt,
        })
        .from(projectStatusHistory)
        .where(eq(projectStatusHistory.projectId, data.id))
        .orderBy(asc(projectStatusHistory.createdAt))
    : [];

  const viewerIsStaff = isStaff(viewer);
  const viewerIsOwner = !!viewer && project.proposerId === viewer.id;
  // The predicate, not a copy of it. An inline reimplementation here used to
  // deny staff on an archived project while the write paths that call
  // canEditProject allowed it, so the page hid an edit button for a write the
  // server would have accepted.
  const canEdit = canEditProject(project, viewer);

  return {
    project: detail,
    history,
    canEdit,
    viewerIsStaff,
    viewerIsOwner,
  };
}

export async function getProjectImpl(data: { id: string }) {
  return getProjectAs(await getViewer(), data);
}

export interface ProposerForEdit {
  accountLinked: boolean;
  accountName: string | null;
  email: string;
}

export async function getProposerForEditAs(
  viewer: Viewer,
  data: { projectId: string }
): Promise<ProposerForEdit> {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const [project] = await db
    .select({
      proposerId: projects.proposerId,
      proposerEmail: projects.proposerEmail,
    })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    return { accountLinked: false, accountName: null, email: "" };
  }
  // proposerId is canonical: when the project is linked to an account, prefill
  // that account's current email so an untouched staff save re-resolves to the
  // same proposer. Fall back to the stored email only when no account is linked.
  if (project.proposerId) {
    const [account] = await db
      .select({ email: user.email, name: user.name })
      .from(user)
      .where(eq(user.id, project.proposerId));
    if (account?.email) {
      return {
        accountLinked: true,
        accountName: account.name ?? null,
        email: account.email,
      };
    }
  }
  return {
    accountLinked: false,
    accountName: null,
    email: project.proposerEmail ?? "",
  };
}

export interface ProjectMentorship {
  /** As stored. Empty string when unset, so the input can bind to it directly. */
  mentorEmail: string;
  /** The account at that address, if one exists. Null is "no account yet". */
  mentorName: string | null;
  studentProposed: boolean;
}

/**
 * The staff read of the mentor address. The public payload carries only the
 * resolved name; this is the one endpoint that returns the address, and it
 * must not widen, for the same reason `getProposerForEditAs` does not.
 */
export async function getProjectMentorshipAs(
  viewer: Viewer,
  data: { projectId: string }
): Promise<ProjectMentorship> {
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const [row] = await db
    .select({
      mentorEmail: projects.mentorEmail,
      mentorName: mentorNameSql,
      studentProposed: projects.studentProposed,
    })
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!row) {
    throw new Error("Project not found");
  }
  return {
    mentorEmail: row.mentorEmail ?? "",
    mentorName: row.mentorName,
    studentProposed: row.studentProposed,
  };
}

export async function getProjectMentorshipImpl(data: { projectId: string }) {
  return getProjectMentorshipAs(await getViewer(), data);
}

/**
 * Request-context wrapper. Mirrors the *As / *Impl split the rest of this file
 * uses so integration tests can call the As form directly.
 */
export async function getProposerForEditImpl(data: {
  projectId: string;
}): Promise<ProposerForEdit> {
  return getProposerForEditAs(await getViewer(), data);
}

export async function listProjectEditLogImpl(data: { id: string }) {
  const viewer = await getViewer();
  if (!isStaff(viewer)) {
    throw new Error("Forbidden");
  }
  const rows = await db
    .select()
    .from(projectEditLog)
    .where(eq(projectEditLog.projectId, data.id))
    .orderBy(desc(projectEditLog.createdAt));
  return {
    rows: rows.map((r) => ({
      ...r,
      oldValues: r.oldValues as JsonValue,
      newValues: r.newValues as JsonValue,
    })),
  };
}

export async function listProjectCommentsAs(
  viewer: Viewer,
  data: { id: string }
) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.id));
  if (!(project && canSeeProject(project, viewer))) {
    throw new Error("Forbidden");
  }
  // Join the author so the thread can render a name instead of a raw id. The
  // FK is `onDelete: restrict`, so the row is always there; the left join and
  // the fallback below only guard against a future relaxation of that rule.
  const rows = await db
    .select({
      id: projectComments.id,
      projectId: projectComments.projectId,
      authorId: projectComments.authorId,
      authorName: user.name,
      parentId: projectComments.parentId,
      content: projectComments.content,
      isInternal: projectComments.isInternal,
      createdAt: projectComments.createdAt,
    })
    .from(projectComments)
    .leftJoin(user, eq(user.id, projectComments.authorId))
    .where(eq(projectComments.projectId, data.id))
    .orderBy(asc(projectComments.createdAt));
  return { rows: filterCommentsForViewer(rows, viewer, project) };
}

export async function listProjectCommentsImpl(data: { id: string }) {
  return listProjectCommentsAs(await getViewer(), data);
}
