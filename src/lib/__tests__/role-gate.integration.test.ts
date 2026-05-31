import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";

async function signUpAndVerify(email: string, password: string) {
  await auth.api.signUpEmail({ body: { email, password, name: "Test" } });
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email));
  const response = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  return response.headers.get("set-cookie") as string;
}

describe("role gate", () => {
  it("default role for a new user is 'user'", async () => {
    const cookie = await signUpAndVerify(
      `u-${Date.now()}@example.com`,
      "Password1!"
    );
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.role).toBe("user");
    expect(["admin", "instructor"].includes(session?.user.role ?? "")).toBe(
      false
    );
  });

  it("promotion to admin is reflected in the session", async () => {
    const email = `a-${Date.now()}@example.com`;
    const cookie = await signUpAndVerify(email, "Password1!");
    await db.update(user).set({ role: "admin" }).where(eq(user.email, email));
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.role).toBe("admin");
  });
});
