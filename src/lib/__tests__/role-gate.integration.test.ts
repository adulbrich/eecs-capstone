import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { sessionHeaders } from "#/test/shared/session";

async function signedIn(email: string): Promise<Headers> {
  const { user: created } = await auth.api.createUser({
    body: { email, name: "Test" },
  });
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email));
  return await sessionHeaders(created.id);
}

describe("role gate", () => {
  it("default role for a new user is 'user'", async () => {
    const headers = await signedIn(`u-${Date.now()}@example.com`);
    const session = await auth.api.getSession({ headers });
    expect(session?.user.role).toBe("user");
    expect(["admin", "instructor"].includes(session?.user.role ?? "")).toBe(
      false
    );
  });

  it("promotion to admin is reflected in the session", async () => {
    const email = `a-${Date.now()}@example.com`;
    const headers = await signedIn(email);
    await db.update(user).set({ role: "admin" }).where(eq(user.email, email));
    const session = await auth.api.getSession({ headers });
    expect(session?.user.role).toBe("admin");
  });
});
