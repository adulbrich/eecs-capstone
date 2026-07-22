import { and, asc, desc, eq, isNull, type SQL } from "drizzle-orm";
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
  filterCommentsForViewer,
  isStaff,
  stripStaffOnlyFields,
  type Viewer,
} from "#/lib/project-visibility";
import { projectSummarySelect } from "./project-summary";

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
    return { rows: [] };
  }
  const conditions = [
    eq(projects.proposerId, viewer.id),
    isNull(projects.deletedAt),
  ];
  if (data.status !== "all") {
    conditions.push(eq(projects.status, data.status as ProjectStatus));
  }
  const rows = await db
    .select(projectSummarySelect)
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .where(and(...conditions))
    .orderBy(desc(projects.updatedAt));
  return { rows };
}

interface AdminProjectsFilter {
  includeSoftDeleted: boolean;
  program: string | null;
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
  const conditions: SQL[] = [];
  if (data.status !== "all") {
    conditions.push(eq(projects.status, data.status as ProjectStatus));
  }
  if (!data.includeSoftDeleted) {
    conditions.push(isNull(projects.deletedAt));
  }
  if (data.program) {
    conditions.push(eq(projects.programId, data.program));
  }
  const rows = await db
    .select(projectSummarySelect)
    .from(projects)
    .leftJoin(programs, eq(projects.programId, programs.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
  return { rows };
}

export async function listAdminProjectsImpl(data: AdminProjectsFilter) {
  return listAdminProjectsAs(await getViewer(), data);
}

export async function getProjectImpl(data: { id: string }) {
  const viewer = await getViewer();
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

  const stripped = stripStaffOnlyFields(project, viewer);
  const history = await db
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
    .orderBy(asc(projectStatusHistory.createdAt));

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

export async function listProjectCommentsImpl(data: { id: string }) {
  const viewer = await getViewer();
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.id));
  if (!(project && canSeeProject(project, viewer))) {
    throw new Error("Forbidden");
  }
  const rows = await db
    .select()
    .from(projectComments)
    .where(eq(projectComments.projectId, data.id))
    .orderBy(asc(projectComments.createdAt));
  return { rows: filterCommentsForViewer(rows, viewer, project) };
}
