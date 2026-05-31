import { and, desc, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import { projectBookmarks, projects, session, user } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { BanUserInput, ListUsersInput, SetUserRoleInput } from "../users";

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

function assertAdmin(viewer: AuthUser) {
  if (viewer.role !== "admin") {
    throw new Error("Forbidden");
  }
}

function assertNotSelf(viewer: AuthUser, targetId: string, action: string) {
  if (viewer.id === targetId) {
    throw new Error(`Cannot ${action} yourself`);
  }
}

export async function listUsersImpl(data: ListUsersInput) {
  const conditions: SQL[] = [];
  if (data.q) {
    const q = or(
      ilike(user.email, `%${data.q}%`),
      ilike(user.name, `%${data.q}%`)
    );
    if (q) {
      conditions.push(q);
    }
  }
  if (data.role) {
    conditions.push(eq(user.role, data.role));
  }
  if (!data.includeBanned) {
    const notBanned = or(eq(user.banned, false), isNull(user.banned));
    if (notBanned) {
      conditions.push(notBanned);
    }
  }

  const where = conditions.length ? and(...conditions) : undefined;
  const offset = (data.page - 1) * data.pageSize;

  const rows = await db
    .select({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      banned: user.banned,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(where)
    .orderBy(desc(user.createdAt))
    .limit(data.pageSize)
    .offset(offset);

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(user)
    .where(where);

  return { rows, total: count, page: data.page, pageSize: data.pageSize };
}

export async function listUsersForCurrentUser(data: ListUsersInput) {
  const viewer = await requireUser();
  assertAdmin(viewer);
  return listUsersImpl(data);
}

export async function getUserImpl(data: { id: string }) {
  const [target] = await db.select().from(user).where(eq(user.id, data.id));
  if (!target) {
    throw new Error("User not found");
  }

  const [{ count: projectCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projects)
    .where(eq(projects.proposerId, data.id));

  const recentProjects = await db
    .select({
      id: projects.id,
      title: projects.title,
      status: projects.status,
      publishedAt: projects.publishedAt,
      description: projects.description,
    })
    .from(projects)
    .where(eq(projects.proposerId, data.id))
    .orderBy(desc(projects.updatedAt))
    .limit(5);

  const [{ count: bookmarkCount }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(projectBookmarks)
    .where(eq(projectBookmarks.userId, data.id));

  return {
    user: target,
    projectCount,
    recentProjects,
    bookmarkCount,
  };
}

export async function getUserForCurrentUser(data: { id: string }) {
  const viewer = await requireUser();
  assertAdmin(viewer);
  return getUserImpl(data);
}

export async function setUserRoleAs(viewer: AuthUser, data: SetUserRoleInput) {
  assertAdmin(viewer);
  assertNotSelf(viewer, data.userId, "change the role of");
  await db
    .update(user)
    .set({ role: data.role, updatedAt: new Date() })
    .where(eq(user.id, data.userId));
  return { id: data.userId, role: data.role };
}

export async function setUserRoleForCurrentUser(data: SetUserRoleInput) {
  const viewer = await requireUser();
  return setUserRoleAs(viewer, data);
}

export async function banUserAs(viewer: AuthUser, data: BanUserInput) {
  assertAdmin(viewer);
  assertNotSelf(viewer, data.userId, "ban");
  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        banned: true,
        banReason: data.reason,
        banExpires: data.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(user.id, data.userId));
    await tx.delete(session).where(eq(session.userId, data.userId));
  });
  return { id: data.userId, banned: true as const };
}

export async function banUserForCurrentUser(data: BanUserInput) {
  const viewer = await requireUser();
  return banUserAs(viewer, data);
}

export async function unbanUserAs(viewer: AuthUser, data: { userId: string }) {
  assertAdmin(viewer);
  await db
    .update(user)
    .set({
      banned: false,
      banReason: null,
      banExpires: null,
      updatedAt: new Date(),
    })
    .where(eq(user.id, data.userId));
  return { id: data.userId, banned: false as const };
}

export async function unbanUserForCurrentUser(data: { userId: string }) {
  const viewer = await requireUser();
  return unbanUserAs(viewer, data);
}
