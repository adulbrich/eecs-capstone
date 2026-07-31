import { and, desc, eq, ilike, isNull, or, type SQL, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  account,
  projectBookmarks,
  projects,
  session,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { isStaff } from "#/lib/project-visibility";
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

function assertStaff(viewer: AuthUser) {
  if (!isStaff({ id: viewer.id, role: viewer.role ?? null })) {
    throw new Error("Forbidden");
  }
}

const SEARCH_LIMIT = 10;

// A whitelist, not a lookup by string: a sort key arrives from the URL as an
// arbitrary string, and an unvalidated column name reaching ORDER BY is an
// injection surface.
const USER_SORT_COLUMNS = {
  banned: user.banned,
  createdAt: user.createdAt,
  email: user.email,
  name: user.name,
  role: user.role,
} as const;

function isUserSortColumn(key: string): key is keyof typeof USER_SORT_COLUMNS {
  // `key in USER_SORT_COLUMNS` walks the prototype chain, so "constructor",
  // "toString", "hasOwnProperty", "valueOf", and "__proto__" would all pass
  // the guard and resolve to an Object.prototype value instead of a
  // PgColumn. Object.hasOwn checks only the object's own properties.
  return Object.hasOwn(USER_SORT_COLUMNS, key);
}

/**
 * Builds the ORDER BY clause for the users listing. Nulls sort last in both
 * directions, matching every client-sorted table on this branch. Postgres
 * defaults to NULLS LAST for ASC but NULLS FIRST for DESC, so the DESC case
 * needs it stated explicitly. `asc()`/`desc()` cannot express that, so the
 * clause is built with `sql` instead.
 *
 * An unknown or absent sort key, or a sort without a valid direction, falls
 * back to createdAt descending, which is the pre-sorting behavior. This
 * includes the case where the column is valid but `dir` is missing or
 * invalid: a caller cannot get a whitelisted column sorted without also
 * supplying a valid direction, the whole request falls back together rather
 * than defaulting the direction silently.
 */
function userOrderBy(sort: string | undefined, dir: string | undefined) {
  if (sort && isUserSortColumn(sort) && (dir === "asc" || dir === "desc")) {
    const column = USER_SORT_COLUMNS[sort];
    return dir === "desc"
      ? sql`${column} DESC NULLS LAST`
      : sql`${column} ASC NULLS LAST`;
  }
  return sql`${user.createdAt} DESC NULLS LAST`;
}

export async function searchUsersAs(
  viewer: AuthUser,
  data: { q: string }
): Promise<{ id: string; name: string; email: string }[]> {
  assertStaff(viewer);
  const q = data.q.trim();
  if (!q) {
    return [];
  }
  return await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(or(ilike(user.email, `%${q}%`), ilike(user.name, `%${q}%`)))
    .orderBy(user.email)
    .limit(SEARCH_LIMIT);
}

export async function searchUsersForCurrentUser(data: { q: string }) {
  const viewer = await requireUser();
  return searchUsersAs(viewer, data);
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
    .orderBy(userOrderBy(data.sort, data.dir))
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

  // Sign-in sources (Better Auth account providers): "github", "google",
  // "credential" (email/password), etc. A user usually has one.
  const accounts = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, data.id));
  const providers = [...new Set(accounts.map((a) => a.providerId))];

  return {
    user: target,
    projectCount,
    recentProjects,
    bookmarkCount,
    providers,
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

export async function listMentorsAs(
  viewer: AuthUser,
  data: { q: string } = { q: "" }
) {
  assertStaff(viewer);
  const conditions = [eq(user.wantsToMentor, true)];
  const trimmed = data.q.trim();
  if (trimmed) {
    // The `user` table carries no tsvector, so this is substring matching.
    // Adequate for a list of a few dozen people.
    const like = `%${trimmed}%`;
    const match = or(
      ilike(user.name, like),
      ilike(user.email, like),
      ilike(user.affiliation, like)
    );
    if (match) {
      conditions.push(match);
    }
  }
  const rows = await db
    .select({
      affiliation: user.affiliation,
      email: user.email,
      id: user.id,
      mentorTeamCount: user.mentorTeamCount,
      name: user.name,
    })
    .from(user)
    .where(and(...conditions))
    .orderBy(user.name);
  return { rows };
}

export async function setUserMentorStatusAs(
  viewer: AuthUser,
  data: { userId: string; wantsToMentor: boolean; mentorTeamCount: number }
) {
  assertStaff(viewer);
  await db
    .update(user)
    .set({
      wantsToMentor: data.wantsToMentor,
      mentorTeamCount: data.mentorTeamCount,
      updatedAt: new Date(),
    })
    .where(eq(user.id, data.userId));
  return { ok: true as const };
}

export async function listMentorsForCurrentUser(data: { q: string }) {
  return listMentorsAs(await requireUser(), data);
}

export async function setUserMentorStatusForCurrentUser(data: {
  userId: string;
  wantsToMentor: boolean;
  mentorTeamCount: number;
}) {
  return setUserMentorStatusAs(await requireUser(), data);
}
