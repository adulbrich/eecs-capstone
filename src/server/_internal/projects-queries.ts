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
  canSeeProject,
  canSeeStatusHistory,
  filterCommentsForViewer,
  isStaff,
  stripPrivateFields,
  type Viewer,
} from "#/lib/project-visibility";
import {
  adminProjectSummarySelect,
  projectSummarySelect,
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
  // The scope the proposer dropdown is built from: status, program and the
  // soft-delete switch, but NOT the search text or the proposer choice itself.
  // Excluding the proposer keeps the option you picked from being the only one
  // left; excluding `q` keeps typing in the search box from emptying the
  // dropdown underneath you.
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

  const listConditions: SQL[] = [...scope];
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
 * Test seam. Integration tests call this directly with a viewer instead of
 * going through the request session, matching the `*As(viewer, ...)`
 * convention used by the mutation helpers.
 */
export async function getProjectAs(viewer: Viewer, data: { id: string }) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.id));
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

  // The embedding vector is never returned to any client, staff included:
  // no UI reads it, and shipping ~8KB of floats on every project-detail load
  // is pure payload bloat.
  const stripped = {
    ...stripPrivateFields(project, viewer),
    embedding: null,
    embeddingSourceHash: null,
    embeddingUpdatedAt: null,
  };
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
  const canEdit =
    !!viewer &&
    !project.deletedAt &&
    (viewerIsStaff || viewerIsOwner) &&
    project.status !== "archived";

  return {
    project: stripped,
    history,
    canEdit,
    viewerIsStaff,
    viewerIsOwner,
  };
}

export async function getProjectImpl(data: { id: string }) {
  return getProjectAs(await getViewer(), data);
}

export async function getProposerEmailForEditImpl(data: {
  projectId: string;
}): Promise<string> {
  const viewer = await getViewer();
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
    return "";
  }
  // proposerId is canonical: when the project is linked to an account, prefill
  // that account's current email so an untouched staff save re-resolves to the
  // same proposer. Fall back to the stored email only when no account is linked.
  if (project.proposerId) {
    const [account] = await db
      .select({ email: user.email })
      .from(user)
      .where(eq(user.id, project.proposerId));
    if (account?.email) {
      return account.email;
    }
  }
  return project.proposerEmail ?? "";
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
