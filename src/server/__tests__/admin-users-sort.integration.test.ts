import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { listUsersImpl } from "#/server/_internal/users";

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

describe("listUsersImpl sorting", () => {
  it("sorts ascending by email", async () => {
    await makeUser("charlie@example.edu", "user");
    await makeUser("alice@example.edu", "user");
    await makeUser("bob@example.edu", "user");

    const { rows } = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
      sort: "email",
      dir: "asc",
    });
    expect(rows.map((r) => r.email)).toEqual([
      "alice@example.edu",
      "bob@example.edu",
      "charlie@example.edu",
    ]);
  });

  it("sorts descending by email", async () => {
    await makeUser("charlie@example.edu", "user");
    await makeUser("alice@example.edu", "user");
    await makeUser("bob@example.edu", "user");

    const { rows } = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
      sort: "email",
      dir: "desc",
    });
    expect(rows.map((r) => r.email)).toEqual([
      "charlie@example.edu",
      "bob@example.edu",
      "alice@example.edu",
    ]);
  });

  it("sorts ascending and descending by name", async () => {
    // user.name is NOT NULL at the database level (see auth-schema.ts), so a
    // null name can never reach this query; this test only proves the `name`
    // whitelist entry orders correctly. The null-ordering guarantee is
    // exercised below on `banned`, which is genuinely nullable.
    await makeUser("charlie@example.edu", "user");
    await makeUser("alice@example.edu", "user");
    await makeUser("bob@example.edu", "user");

    const ascending = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
      sort: "name",
      dir: "asc",
    });
    expect(ascending.rows.map((r) => r.name)).toEqual([
      "alice@example.edu",
      "bob@example.edu",
      "charlie@example.edu",
    ]);

    const descending = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
      sort: "name",
      dir: "desc",
    });
    expect(descending.rows.map((r) => r.name)).toEqual([
      "charlie@example.edu",
      "bob@example.edu",
      "alice@example.edu",
    ]);
  });

  it("sorts nulls last in both directions, using banned since name cannot be null", async () => {
    const notBanned = await makeUser("banned-false@example.edu", "user");
    const banned = await makeUser("banned-true@example.edu", "user");
    const unknown = await makeUser("banned-null@example.edu", "user");
    await db.update(user).set({ banned: true }).where(eq(user.id, banned.id));
    await db.update(user).set({ banned: null }).where(eq(user.id, unknown.id));
    // notBanned's row stays at the schema default (false); asserted below.
    expect(notBanned.role).toBe("user");

    const ascending = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
      sort: "banned",
      dir: "asc",
    });
    expect(ascending.rows.map((r) => r.banned)).toEqual([false, true, null]);

    const descending = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
      sort: "banned",
      dir: "desc",
    });
    expect(descending.rows.map((r) => r.banned)).toEqual([true, false, null]);
  });

  it("falls back to createdAt desc for an unknown sort value", async () => {
    const base = Date.now();
    const older = await makeUser("older@example.edu", "user");
    const newer = await makeUser("newer@example.edu", "user");
    // Explicit, distinct timestamps: default-now insertion order is not
    // guaranteed to differ between two sequential signups within the same
    // millisecond, and this test asserts a specific order.
    await db
      .update(user)
      .set({ createdAt: new Date(base) })
      .where(eq(user.id, older.id));
    await db
      .update(user)
      .set({ createdAt: new Date(base + 1000) })
      .where(eq(user.id, newer.id));

    const { rows } = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 50,
      sort: "not-a-real-column",
      dir: "asc",
    });
    expect(rows.map((r) => r.email)).toEqual([
      "newer@example.edu",
      "older@example.edu",
    ]);
  });

  it("composes sorting with the existing role filter", async () => {
    // Inserted in email-ascending order, so createdAt-desc (the unsorted
    // fallback) would yield admin-b, admin-a: the opposite of what this test
    // expects. That divergence is what makes the assertion decisive rather
    // than a coincidental pass.
    await makeUser("admin-a@example.edu", "admin");
    await makeUser("admin-b@example.edu", "admin");
    await makeUser("user-c@example.edu", "user");

    const { rows } = await listUsersImpl({
      q: "",
      role: "admin",
      includeBanned: true,
      page: 1,
      pageSize: 50,
      sort: "email",
      dir: "asc",
    });
    expect(rows.map((r) => r.email)).toEqual([
      "admin-a@example.edu",
      "admin-b@example.edu",
    ]);
  });

  it("composes sorting with pagination", async () => {
    const emails = [
      "a@example.edu",
      "b@example.edu",
      "c@example.edu",
      "d@example.edu",
    ];
    for (const email of emails) {
      await makeUser(email, "user");
    }

    const page1 = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 1,
      pageSize: 2,
      sort: "email",
      dir: "asc",
    });
    const page2 = await listUsersImpl({
      q: "",
      role: null,
      includeBanned: true,
      page: 2,
      pageSize: 2,
      sort: "email",
      dir: "asc",
    });
    expect(page1.rows.map((r) => r.email)).toEqual([
      "a@example.edu",
      "b@example.edu",
    ]);
    expect(page2.rows.map((r) => r.email)).toEqual([
      "c@example.edu",
      "d@example.edu",
    ]);
    expect(page1.total).toBe(4);
  });
});
