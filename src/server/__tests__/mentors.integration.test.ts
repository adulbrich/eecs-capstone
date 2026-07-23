import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { listMentorsAs, setUserMentorStatusAs } from "#/server/_internal/users";

async function makeUser(email: string, role: "user" | "instructor" | "admin") {
  await auth.api.signUpEmail({
    body: { email, password: "Password1!", name: email },
  });
  await db
    .update(user)
    .set({ emailVerified: true, ...(role === "user" ? {} : { role }) })
    .where(eq(user.email, email));
  const [u] = await db.select().from(user).where(eq(user.email, email));
  return { id: u.id, role: u.role };
}

describe("mentor server functions", () => {
  it("lists only opted-in users", async () => {
    const staff = await makeUser(`s-${Date.now()}@x.com`, "instructor");
    const mentor = await makeUser(`m-${Date.now()}@x.com`, "user");
    const other = await makeUser(`o-${Date.now()}@x.com`, "user");
    await db
      .update(user)
      .set({ wantsToMentor: true, mentorTeamCount: 2, affiliation: "OSU" })
      .where(eq(user.id, mentor.id));

    const { rows } = await listMentorsAs(staff);
    expect(rows.map((r) => r.id)).toEqual([mentor.id]);
    expect(rows[0].mentorTeamCount).toBe(2);
    expect(rows.map((r) => r.id)).not.toContain(other.id);
  });

  it("refuses a non-staff viewer", async () => {
    const plain = await makeUser(`p-${Date.now()}@x.com`, "user");
    await expect(listMentorsAs(plain)).rejects.toThrow("Forbidden");
  });

  it("staff can edit a user's mentor status", async () => {
    const staff = await makeUser(`s2-${Date.now()}@x.com`, "admin");
    const target = await makeUser(`u-${Date.now()}@x.com`, "user");
    await db
      .update(user)
      .set({ wantsToMentor: true, mentorTeamCount: 3 })
      .where(eq(user.id, target.id));

    await setUserMentorStatusAs(staff, {
      userId: target.id,
      wantsToMentor: false,
      mentorTeamCount: 1,
    });
    const [row] = await db.select().from(user).where(eq(user.id, target.id));
    expect(row.wantsToMentor).toBe(false);

    await expect(
      setUserMentorStatusAs(target, {
        userId: target.id,
        wantsToMentor: true,
        mentorTeamCount: 2,
      })
    ).rejects.toThrow("Forbidden");
  });
});
