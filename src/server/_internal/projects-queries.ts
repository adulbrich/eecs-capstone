import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  projectComments,
  projectEditLog,
  projectStatusHistory,
  projects,
} from "#/db/schema";
import { readSession } from "#/lib/_internal/auth-guards";
import {
  canSeeProject,
  filterCommentsForViewer,
  isStaff,
  stripStaffOnlyFields,
  type Viewer,
} from "#/lib/project-visibility";

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

export async function listPublishedProjectsImpl(data: {
  page: number;
  pageSize: number;
}) {
  const offset = (data.page - 1) * data.pageSize;
  const rows = await db
    .select()
    .from(projects)
    .where(and(eq(projects.status, "published"), isNull(projects.deletedAt)))
    .orderBy(desc(projects.publishedAt))
    .limit(data.pageSize)
    .offset(offset);
  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(and(eq(projects.status, "published"), isNull(projects.deletedAt)));
  return { rows, total: count, page: data.page, pageSize: data.pageSize };
}

export async function listMyProjectsImpl(data: { status: StatusFilter }) {
  const viewer = await getViewer();
  if (!viewer) return { rows: [] };
  const conditions = [
    eq(projects.proposerId, viewer.id),
    isNull(projects.deletedAt),
  ];
  if (data.status !== "all") {
    conditions.push(eq(projects.status, data.status as ProjectStatus));
  }
  const rows = await db
    .select()
    .from(projects)
    .where(and(...conditions))
    .orderBy(desc(projects.updatedAt));
  return { rows };
}

export async function listAdminProjectsImpl(data: {
  status: StatusFilter;
  includeSoftDeleted: boolean;
}) {
  const viewer = await getViewer();
  if (!isStaff(viewer)) throw new Error("Forbidden");
  const conditions = [];
  if (data.status !== "all") {
    conditions.push(eq(projects.status, data.status as ProjectStatus));
  }
  if (!data.includeSoftDeleted) {
    conditions.push(isNull(projects.deletedAt));
  }
  const rows = await db
    .select()
    .from(projects)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(projects.updatedAt));
  return { rows };
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

export async function listProjectEditLogImpl(data: { id: string }) {
  const viewer = await getViewer();
  if (!isStaff(viewer)) throw new Error("Forbidden");
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
  if (!project || !canSeeProject(project, viewer)) {
    throw new Error("Forbidden");
  }
  const rows = await db
    .select()
    .from(projectComments)
    .where(eq(projectComments.projectId, data.id))
    .orderBy(asc(projectComments.createdAt));
  return { rows: filterCommentsForViewer(rows, viewer) };
}
