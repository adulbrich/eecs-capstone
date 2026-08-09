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

/**
 * The account at exactly this address, if there is one. Deliberately not
 * `searchUsersAs` with a full address: that one substring-matches, orders by
 * email and truncates at SEARCH_LIMIT, so an address whose text is contained
 * in enough other addresses falls outside the returned window and reads as
 * "no account". A caller deciding whether an account exists needs an answer
 * that no result limit can change.
 *
 * `lower(email) = lower(input)` rather than `ilike`, because LIKE treats `_`
 * as a single-character wildcard and underscores are ordinary in addresses.
 */
export async function lookupUserByEmailAs(
  viewer: AuthUser,
  data: { email: string }
): Promise<{ id: string; name: string; email: string } | null> {
  assertStaff(viewer);
  const email = data.email.trim().toLowerCase();
  if (!email) {
    return null;
  }
  const [match] = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(sql`lower(${user.email})`, email))
    .limit(1);
  return match ?? null;
}

export async function lookupUserByEmailForCurrentUser(data: { email: string }) {
  const viewer = await requireUser();
  return lookupUserByEmailAs(viewer, data);
}

function buildUserConditions(data: ListUsersInput): SQL[] {
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
  return conditions;
}

export async function listUsersImpl(data: ListUsersInput) {
  const conditions = buildUserConditions(data);
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

/**
 * The admin CSV export. Same conditions and order as the listing, no
 * pagination, and every user column except authentication material: nothing
 * from `account` or `session` is joined.
 */
export async function exportUsersImpl(data: ListUsersInput) {
  const conditions = buildUserConditions(data);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      emailVerified: user.emailVerified,
      image: user.image,
      role: user.role,
      banned: user.banned,
      banReason: user.banReason,
      banExpires: user.banExpires,
      affiliation: user.affiliation,
      linkedin: user.linkedin,
      wantsToMentor: user.wantsToMentor,
      mentorTeamCount: user.mentorTeamCount,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    })
    .from(user)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(userOrderBy(data.sort, data.dir));
  return { rows };
}

/**
 * Gated with assertAdmin, not assertStaff. /admin/users requires
 * `role === "admin"` exactly, unlike every other admin route, and a server
 * function is a public endpoint rather than a page the router can redirect.
 *
 * Split out from the wrapper below so integration tests can exercise the gate
 * with a plain viewer, the way they do for every other *As helper.
 */
export async function exportUsersAs(viewer: AuthUser, data: ListUsersInput) {
  assertAdmin(viewer);
  return await exportUsersImpl(data);
}

export async function exportUsersForCurrentUser(data: ListUsersInput) {
  const viewer = await requireUser();
  return exportUsersAs(viewer, data);
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

function buildMentorConditions(data: { q: string }): SQL[] {
  const conditions: SQL[] = [eq(user.wantsToMentor, true)];
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
  return conditions;
}

export async function listMentorsAs(
  viewer: AuthUser,
  data: { q: string } = { q: "" }
) {
  assertStaff(viewer);
  const rows = await db
    .select({
      affiliation: user.affiliation,
      email: user.email,
      id: user.id,
      mentorTeamCount: user.mentorTeamCount,
      name: user.name,
    })
    .from(user)
    .where(and(...buildMentorConditions(data)))
    .orderBy(user.name);
  return { rows };
}

/**
 * The staff CSV export. Widens the five-column listing with role,
 * wantsToMentor and createdAt.
 *
 * `wantsToMentor` is constant true across the whole result set by
 * construction. It is included anyway so a spreadsheet that gets filtered and
 * re-sorted still says what it is a list of.
 */
export async function exportMentorsAs(
  viewer: AuthUser,
  data: { q: string } = { q: "" }
) {
  assertStaff(viewer);
  const rows = await db
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
      affiliation: user.affiliation,
      role: user.role,
      wantsToMentor: user.wantsToMentor,
      mentorTeamCount: user.mentorTeamCount,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(and(...buildMentorConditions(data)))
    .orderBy(user.name);
  return { rows };
}

export async function exportMentorsForCurrentUser(data: { q: string }) {
  const viewer = await requireUser();
  return exportMentorsAs(viewer, data);
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
