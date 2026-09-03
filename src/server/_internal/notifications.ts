import { and, count, desc, eq } from "drizzle-orm";
import { db } from "#/db";
import { notifications } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";

/**
 * A notification row is visible to its recipient and to nobody else, and only
 * the recipient may mark it read. There is no staff read path. Every query
 * below therefore carries `userId = viewer.id`, and the integration suite
 * proves that a foreign id reads nothing and updates zero rows.
 */
interface AuthUser {
  id: string;
}

export async function listMyNotificationsAs(viewer: AuthUser) {
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, viewer.id))
    .orderBy(desc(notifications.createdAt))
    .limit(10);
  return { rows };
}

export async function listMyNotificationsForCurrentUser() {
  const viewer = await requireUser();
  return listMyNotificationsAs(viewer);
}

export async function unreadCountAs(viewer: AuthUser) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(eq(notifications.userId, viewer.id), eq(notifications.read, false))
    );
  return { count: value };
}

export async function unreadCountForCurrentUser() {
  const viewer = await requireUser();
  return unreadCountAs(viewer);
}

export async function markReadAs(viewer: AuthUser, data: { id: string }) {
  // The scope is in the predicate, not in a guard above it: a foreign id
  // updates zero rows rather than someone else's, and there is no standalone
  // `if` that could be deleted while the suite stays green.
  await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(eq(notifications.id, data.id), eq(notifications.userId, viewer.id))
    );
  return { id: data.id };
}

export async function markReadForCurrentUser(data: { id: string }) {
  const viewer = await requireUser();
  return markReadAs(viewer, data);
}

export async function markAllReadAs(viewer: AuthUser) {
  await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.userId, viewer.id));
  return { ok: true };
}

export async function markAllReadForCurrentUser() {
  const viewer = await requireUser();
  return markAllReadAs(viewer);
}
