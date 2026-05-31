import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { session, user } from "#/db/schema";
import { auth } from "#/lib/auth";
import {
  banUserAs,
  listUsersImpl,
  setUserRoleAs,
  unbanUserAs,
} from "#/server/_internal/users";

async function makeUser(email: string, role: "user" | "admin" | "instructor") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, role })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

describe("listUsersImpl", () => {
  it("q matches email and name (separately)", async () => {
    await makeUser(`alice-${Date.now()}@x.com`, "user");
    await makeUser(`bob-${Date.now()}@x.com`, "user");

    const byEmail = await listUsersImpl({
      q: "alice",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(byEmail.rows.some((r) => r.email.includes("alice"))).toBe(true);
    expect(byEmail.rows.some((r) => r.email.includes("bob"))).toBe(false);
  });

  it("role filter restricts results", async () => {
    await makeUser(`u1-${Date.now()}@x.com`, "user");
    await makeUser(`a1-${Date.now()}@x.com`, "admin");

    const admins = await listUsersImpl({
      q: "",
      role: "admin",
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(admins.rows.every((r) => r.role === "admin")).toBe(true);
  });

  it("includeBanned=false hides banned users", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`t-${Date.now()}@x.com`, "user");
    await banUserAs(admin, {
      userId: target.id,
      reason: "test",
      expiresAt: null,
    });

    const withBanned = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
    });
    expect(withBanned.rows.some((r) => r.id === target.id)).toBe(true);

    const hidden = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: false,
      page: 1,
      pageSize: 50,
    });
    expect(hidden.rows.some((r) => r.id === target.id)).toBe(false);
  });
});

describe("setUserRoleAs", () => {
  it("admin can change another user's role", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`u-${Date.now()}@x.com`, "user");

    await setUserRoleAs(admin, { userId: target.id, role: "instructor" });
    const [updated] = await db
      .select()
      .from(user)
      .where(eq(user.id, target.id));
    expect(updated.role).toBe("instructor");
  });

  it("refuses self-action", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    await expect(
      setUserRoleAs(admin, { userId: admin.id, role: "user" })
    ).rejects.toThrow(/yourself/);
  });

  it("refuses non-admin caller", async () => {
    const instructor = await makeUser(`i-${Date.now()}@x.com`, "instructor");
    const target = await makeUser(`u-${Date.now()}@x.com`, "user");
    await expect(
      setUserRoleAs(instructor, { userId: target.id, role: "admin" })
    ).rejects.toThrow();
  });
});

describe("banUserAs / unbanUserAs", () => {
  it("ban updates the three columns AND revokes sessions", async () => {
    const admin = await makeUser(`a-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`t-${Date.now()}@x.com`, "user");

    // Insert a synthetic session row for the target to verify revoke.
    await db.insert(session).values({
      id: `s-${Date.now()}`,
      userId: target.id,
      token: `tok-${Date.now()}`,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });

    await banUserAs(admin, {
      userId: target.id,
      reason: "test ban",
      expiresAt: null,
    });

    const [updated] = await db
      .select()
      .from(user)
      .where(eq(user.id, target.id));
    expect(updated.banned).toBe(true);
    expect(updated.banReason).toBe("test ban");
    expect(updated.banExpires).toBeNull();

    const sessions = await db
      .select()
      .from(session)
      .where(eq(session.userId, target.id));
    expect(sessions.length).toBe(0);
  });

  it("ban refuses self-action", async () => {
    const admin = await makeUser(`a2-${Date.now()}@x.com`, "admin");
    await expect(
      banUserAs(admin, {
        userId: admin.id,
        reason: "x",
        expiresAt: null,
      })
    ).rejects.toThrow(/yourself/);
  });

  it("unban clears the three columns", async () => {
    const admin = await makeUser(`a3-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`t2-${Date.now()}@x.com`, "user");
    await banUserAs(admin, {
      userId: target.id,
      reason: "test",
      expiresAt: null,
    });
    await unbanUserAs(admin, { userId: target.id });

    const [updated] = await db
      .select()
      .from(user)
      .where(eq(user.id, target.id));
    expect(updated.banned).toBe(false);
    expect(updated.banReason).toBeNull();
    expect(updated.banExpires).toBeNull();
  });
});
