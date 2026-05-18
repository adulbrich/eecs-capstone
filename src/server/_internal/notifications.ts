import { and, count, desc, eq } from "drizzle-orm";
import { db } from "#/db";
import { notifications } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";

export async function listMyNotificationsImpl() {
  const viewer = await requireUser();
  const rows = await db
    .select()
    .from(notifications)
    .where(eq(notifications.userId, viewer.id))
    .orderBy(desc(notifications.createdAt))
    .limit(10);
  return { rows };
}

export async function unreadCountImpl() {
  const viewer = await requireUser();
  const [{ value }] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(eq(notifications.userId, viewer.id), eq(notifications.read, false)),
    );
  return { count: value };
}

export async function markReadImpl(data: { id: string }) {
  const viewer = await requireUser();
  await db
    .update(notifications)
    .set({ read: true })
    .where(
      and(eq(notifications.id, data.id), eq(notifications.userId, viewer.id)),
    );
  return { id: data.id };
}

export async function markAllReadImpl() {
  const viewer = await requireUser();
  await db
    .update(notifications)
    .set({ read: true })
    .where(eq(notifications.userId, viewer.id));
  return { ok: true };
}
