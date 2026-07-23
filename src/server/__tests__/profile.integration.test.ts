import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { updateProfileAs } from "#/server/_internal/profile";

async function makeUser(email: string) {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role, email: u.email };
}

describe("profile", () => {
  it("persists mentor fields", async () => {
    const u = await makeUser(`m-${Date.now()}@x.com`);
    await updateProfileAs(u.id, {
      affiliation: "OSU",
      linkedin: null,
      mentorTeamCount: 4,
      name: "Dana Lee",
      wantsToMentor: true,
    });
    const [row] = await db.select().from(user).where(eq(user.id, u.id));
    expect(row.wantsToMentor).toBe(true);
    expect(row.mentorTeamCount).toBe(4);
  });
});
