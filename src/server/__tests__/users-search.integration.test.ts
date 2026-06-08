import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { searchUsersAs } from "../_internal/users";

async function makeUser(email: string, role: "user" | "instructor" | "admin") {
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

describe("searchUsers", () => {
  it("matches by email fragment for a staff viewer", async () => {
    const staff = await makeUser(`staff-${Date.now()}@x.com`, "instructor");
    const target = await makeUser(`needle-${Date.now()}@x.com`, "user");

    const rows = await searchUsersAs(staff, { q: "needle" });
    expect(rows.some((r) => r.id === target.id)).toBe(true);
    expect(rows[0]).toHaveProperty("email");
    expect(rows[0]).not.toHaveProperty("banned");
  });

  it("forbids a non-staff viewer", async () => {
    const plain = await makeUser(`plain-${Date.now()}@x.com`, "user");
    await expect(searchUsersAs(plain, { q: "x" })).rejects.toThrow("Forbidden");
  });

  it("returns an empty list for a blank query", async () => {
    const staff = await makeUser(`staff2-${Date.now()}@x.com`, "admin");
    const rows = await searchUsersAs(staff, { q: "" });
    expect(rows).toEqual([]);
  });
});
