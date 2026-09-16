import {
  and,
  desc,
  eq,
  ilike,
  isNull,
  or,
  type SQL,
  type SQLWrapper,
  sql,
} from "drizzle-orm";
import { db } from "#/db";
import {
  account,
  aiReviewUsage,
  projectBookmarks,
  projects,
  session,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { AI_FEATURE_NOUN, type AiFeature } from "#/lib/ai-review-limits";
import { assertAdmin, assertStaff } from "#/lib/viewer";
import type { BanUserInput, ListUsersInput, SetUserRoleInput } from "../users";
import {
  notifyBannedByEmail,
  notifyRoleChangedByEmail,
} from "./account-emails";
import type { EmailOptions } from "./email-dispatch";

/** The address an account email goes to, or null for an id that names nobody. */
async function addressOf(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ email: user.email })
    .from(user)
    .where(eq(user.id, userId));
  return row?.email ?? null;
}

interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

function assertNotSelf(viewer: AuthUser, targetId: string, action: string) {
  if (viewer.id === targetId) {
    throw new Error(`Cannot ${action} yourself`);
  }
}

const SEARCH_LIMIT = 10;

/**
 * All time, one row per paid Bedrock call, both features together. A
 * correlated subquery rather than a join, so a user who has never used the
 * feature still comes back, with a 0 (#413).
 *
 * `db.$count` rather than a `sql` template of the same shape: in a select
 * projection with no joins, Drizzle strips the table from every column
 * interpolated at the top level, so the hand-written version compared
 * `ai_review_usage.user_id` against `ai_review_usage.id` and the query failed
 * outright. `$count` builds its `where` as a nested `SQL`, which the strip
 * does not descend into, so the qualification survives. See `docs/QUIRKS.md`,
 * Drizzle.
 *
 * Wrapped rather than used bare, for the two things the wrapper adds. `.as`
 * names the output column, which is what the ORDER BY below reads instead of
 * repeating the subquery. And `.mapWith(Number)` is back because wrapping
 * drops `$count`'s own mapping, and node-postgres hands a `count(*)` back as
 * a string.
 */
const aiCallCount =
  sql<number>`${db.$count(aiReviewUsage, eq(aiReviewUsage.userId, user.id))}`
    .mapWith(Number)
    .as("aiCallCount");

// A whitelist, not a lookup by string: a sort key arrives from the URL as an
// arbitrary string, and an unvalidated column name reaching ORDER BY is an
// injection surface.
/** What the listing and the export may both sort by: real columns. */
const USER_COLUMN_SORTS = {
  banned: user.banned,
  createdAt: user.createdAt,
  email: user.email,
  role: user.role,
  name: user.name,
} as const;

/**
 * The listing's, which adds the derived count. It goes through the whitelist
 * rather than around it, the way a real column does.
 *
 * The clause reads the select alias rather than repeating the subquery.
 * Postgres does not notice that two copies of one correlated subquery are the
 * same subquery, so spelling it out in both the projection and the ORDER BY
 * would count every matching user's rows twice. The alias exists only in a
 * query that selects it, which is also why the export's whitelist above does
 * not carry the key: #413 puts the CSV out of scope on exactly that ground,
 * that it would make every exported row pay for the subquery.
 */
const USER_SORT_COLUMNS = {
  ...USER_COLUMN_SORTS,
  aiCallCount: sql.identifier("aiCallCount"),
} as const;

/**
 * The whitelist is the injection guard, so its values are typed rather than
 * left as `unknown`: everything in one is a column or a piece of SQL, and
 * nothing else can reach ORDER BY through it.
 */
type SortColumns = Record<string, SQLWrapper>;

function isSortColumn(columns: SortColumns, key: string): boolean {
  // `key in columns` walks the prototype chain, so "constructor", "toString",
  // "hasOwnProperty", "valueOf", and "__proto__" would all pass the guard and
  // resolve to an Object.prototype value instead of a PgColumn.
  // Object.hasOwn checks only the object's own properties.
  return Object.hasOwn(columns, key);
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
function userOrderBy(
  sort: string | undefined,
  dir: string | undefined,
  columns: SortColumns = USER_SORT_COLUMNS
) {
  if (
    sort &&
    isSortColumn(columns, sort) &&
    (dir === "asc" || dir === "desc")
  ) {
    const column = columns[sort];
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
      aiCallCount,
    })
    .from(user)
    .where(where)
    // `user.id` last, always, and passed here rather than inside
    // `userOrderBy` so that a third branch there cannot forget it. Why an
    // ordering has to be total: "Paging a listing needs a total ordering" in
    // docs/QUIRKS.md (#429). The AI call count is what makes it bite here,
    // since most users share the same value of zero.
    .orderBy(userOrderBy(data.sort, data.dir), user.id)
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
    // The export's own whitelist, without the derived count: an export sorted
    // by it would evaluate the subquery for every user in the table, and the
    // CSV carries no column that would show the order anyway. A request
    // naming it falls back to createdAt desc, as an unknown key does.
    .orderBy(userOrderBy(data.sort, data.dir, USER_COLUMN_SORTS), user.id);
  return { rows };
}

/**
 * Gated with assertAdmin, not assertStaff. The /admin/users routes require
 * `role === "admin"` exactly, where most admin routes accept staff, and a
 * server function is a public endpoint rather than a page the router can
 * redirect.
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

  const aiUsage = await aiUsageFor(data.id);

  return {
    user: target,
    projectCount,
    recentProjects,
    bookmarkCount,
    providers,
    aiUsage,
  };
}

/**
 * One user's paid Bedrock calls, all time, beside the project and bookmark
 * counts this page already carries.
 *
 * Grouped by feature and then filled out from `AI_FEATURE_NOUN`'s keys, so a
 * feature nobody has used yet reports a zero rather than going missing, and a
 * third feature added to the limiter's vocabulary appears here without a
 * second edit. The window is all time on both this page and the listing: the
 * limiter already shows the rolling hour and day where it matters, which is
 * at the point of refusal.
 *
 * Deleting an account takes these rows with it, since `aiReviewUsage` is a
 * cascade edge under ADR 0008, so the count drops to zero against the
 * anonymized row rather than surviving it.
 */
async function aiUsageFor(userId: string) {
  const rows = await db
    .select({
      feature: aiReviewUsage.feature,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${aiReviewUsage.inputTokens}), 0)::int`,
      reasoningTokens: sql<number>`coalesce(sum(${aiReviewUsage.reasoningTokens}), 0)::int`,
      outputTokens: sql<number>`coalesce(sum(${aiReviewUsage.outputTokens}), 0)::int`,
      // `mapWith` or this comes back as the raw timestamp string: an
      // aggregate has no column type for node-postgres to parse it by, and
      // the page renders it through `LocalTime`, which wants a Date.
      lastCallAt: sql<Date | null>`max(${aiReviewUsage.createdAt})`.mapWith(
        aiReviewUsage.createdAt
      ),
    })
    .from(aiReviewUsage)
    .where(eq(aiReviewUsage.userId, userId))
    .groupBy(aiReviewUsage.feature);

  const features = Object.keys(AI_FEATURE_NOUN) as AiFeature[];
  const byFeature = features.map((feature) => ({
    feature,
    calls: rows.find((row) => row.feature === feature)?.calls ?? 0,
  }));
  // A row whose `feature` is not in the vocabulary would vanish from the
  // per-feature list but is still spend, so the totals count every row.
  const lastCallAt = rows.reduce<Date | null>((latest, row) => {
    if (!row.lastCallAt) {
      return latest;
    }
    return latest && latest > row.lastCallAt ? latest : row.lastCallAt;
  }, null);
  return {
    byFeature,
    inputTokens: rows.reduce((sum, row) => sum + row.inputTokens, 0),
    reasoningTokens: rows.reduce((sum, row) => sum + row.reasoningTokens, 0),
    outputTokens: rows.reduce((sum, row) => sum + row.outputTokens, 0),
    lastCallAt,
  };
}

export async function getUserForCurrentUser(data: { id: string }) {
  const viewer = await requireUser();
  assertAdmin(viewer);
  return getUserImpl(data);
}

export async function setUserRoleAs(
  viewer: AuthUser,
  data: SetUserRoleInput,
  opts?: EmailOptions
) {
  assertAdmin(viewer);
  assertNotSelf(viewer, data.userId, "change the role of");
  await db
    .update(user)
    .set({ role: data.role, updatedAt: new Date() })
    .where(eq(user.id, data.userId));
  // After the write; swallows its own errors. Admin-only above, so the skip
  // is read as sent (#386); there is no bell row, the email is the notice.
  const to = await addressOf(data.userId);
  if (to && (opts?.sendEmail ?? true)) {
    await notifyRoleChangedByEmail({ role: data.role, to }, opts?.send);
  }
  return { id: data.userId, role: data.role };
}

export async function setUserRoleForCurrentUser(
  data: SetUserRoleInput & { sendEmail: boolean }
) {
  const viewer = await requireUser();
  const { sendEmail, ...fields } = data;
  return setUserRoleAs(viewer, fields, { sendEmail });
}

export async function banUserAs(
  viewer: AuthUser,
  data: BanUserInput,
  opts?: EmailOptions
) {
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
  // After the transaction, never inside it: a failed email must not undo a
  // ban. The account can no longer sign in, so email is the only channel,
  // and the admin's skip (#386) is the whole difference between told and
  // not told.
  const to = await addressOf(data.userId);
  if (to && (opts?.sendEmail ?? true)) {
    await notifyBannedByEmail(
      { expiresAt: data.expiresAt, reason: data.reason, to },
      opts?.send
    );
  }
  return { id: data.userId, banned: true as const };
}

export async function banUserForCurrentUser(
  data: BanUserInput & { sendEmail: boolean }
) {
  const viewer = await requireUser();
  const { sendEmail, ...fields } = data;
  return banUserAs(viewer, fields, { sendEmail });
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
