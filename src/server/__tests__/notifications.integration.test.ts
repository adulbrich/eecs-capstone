import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { notifications, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  listMyNotificationsAs,
  markAllReadAs,
  markReadAs,
  unreadCountAs,
} from "#/server/_internal/notifications";

/**
 * The rule under test: a notification row is visible to its recipient only,
 * and only the recipient may mark it read. Nothing here creates a
 * notification through the app; the rows are inserted directly, because the
 * writers are covered where they live (projects, comments, inventory) and this
 * suite is about reading and marking.
 */

async function makeUser(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id };
}

async function notify(
  userId: string,
  title: string,
  extra: { read?: boolean; createdAt?: Date } = {}
) {
  const [row] = await db
    .insert(notifications)
    .values({
      userId,
      type: "test",
      title,
      message: title,
      link: null,
      read: extra.read ?? false,
      ...(extra.createdAt ? { createdAt: extra.createdAt } : {}),
    })
    .returning();
  return row;
}

async function readFlag(id: string) {
  const [row] = await db
    .select({ read: notifications.read })
    .from(notifications)
    .where(eq(notifications.id, id));
  return row.read;
}

describe("notifications are scoped to their recipient", () => {
  it("markReadAs with another user's id leaves that row unread", async () => {
    const stamp = Date.now();
    const alice = await makeUser(`n-alice-${stamp}@x.com`);
    const bob = await makeUser(`n-bob-${stamp}@x.com`);
    const row = await notify(alice.id, "for alice");

    await markReadAs(bob, { id: row.id });
    expect(await readFlag(row.id)).toBe(false);

    await markReadAs(alice, { id: row.id });
    expect(await readFlag(row.id)).toBe(true);
  });

  it("listMyNotificationsAs returns only the viewer's rows, newest first, capped at 10", async () => {
    const stamp = Date.now();
    const alice = await makeUser(`n-list-a-${stamp}@x.com`);
    const bob = await makeUser(`n-list-b-${stamp}@x.com`);
    await notify(bob.id, "bob only");
    // Twelve rows a minute apart, oldest first, so the cap and the order are
    // both observable: the two oldest must be the ones that fall off.
    for (let i = 0; i < 12; i++) {
      await notify(alice.id, `alice ${i}`, {
        createdAt: new Date(stamp - (12 - i) * 60_000),
      });
    }

    const { rows } = await listMyNotificationsAs(alice);
    expect(rows).toHaveLength(10);
    expect(rows.every((r) => r.userId === alice.id)).toBe(true);
    expect(rows.map((r) => r.title)).toEqual(
      Array.from({ length: 10 }, (_, i) => `alice ${11 - i}`)
    );

    const bobs = await listMyNotificationsAs(bob);
    expect(bobs.rows.map((r) => r.title)).toEqual(["bob only"]);
  });

  it("unreadCountAs counts only the viewer's unread rows", async () => {
    const stamp = Date.now();
    const alice = await makeUser(`n-count-a-${stamp}@x.com`);
    const bob = await makeUser(`n-count-b-${stamp}@x.com`);
    await notify(alice.id, "unread 1");
    await notify(alice.id, "unread 2");
    await notify(alice.id, "already read", { read: true });
    await notify(bob.id, "bob unread");

    expect((await unreadCountAs(alice)).count).toBe(2);
    expect((await unreadCountAs(bob)).count).toBe(1);
  });

  it("markAllReadAs does not touch the other user's rows", async () => {
    const stamp = Date.now();
    const alice = await makeUser(`n-all-a-${stamp}@x.com`);
    const bob = await makeUser(`n-all-b-${stamp}@x.com`);
    const a1 = await notify(alice.id, "a1");
    const a2 = await notify(alice.id, "a2");
    const b1 = await notify(bob.id, "b1");

    await markAllReadAs(alice);

    expect(await readFlag(a1.id)).toBe(true);
    expect(await readFlag(a2.id)).toBe(true);
    expect(await readFlag(b1.id)).toBe(false);
    expect((await unreadCountAs(alice)).count).toBe(0);
    expect((await unreadCountAs(bob)).count).toBe(1);
  });
});
