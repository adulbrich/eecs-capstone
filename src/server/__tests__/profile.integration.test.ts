import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { updateProfileImpl } from "#/server/_internal/profile";
import { profileSchema } from "#/server/profile";

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
    await updateProfileImpl(u.id, {
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

  // Through the schema rather than straight into the impl: the trim is the
  // validator's, which is the only thing between the form and the column.
  it("stores a name without its padding", async () => {
    const u = await makeUser(`t-${Date.now()}@x.com`);
    await updateProfileImpl(
      u.id,
      profileSchema.parse({
        affiliation: null,
        linkedin: null,
        name: "  Ada  ",
      })
    );
    const [row] = await db.select().from(user).where(eq(user.id, u.id));
    expect(row.name).toBe("Ada");
  });

  it("refuses a save whose name is only spaces", async () => {
    expect(
      profileSchema.safeParse({
        affiliation: null,
        linkedin: null,
        name: "   ",
      }).success
    ).toBe(false);
  });

  // The form marks the field required, so this is the endpoint being called
  // directly. Better Auth validates `name` with a bare z.string(), which takes
  // "", and the create hook in src/lib/auth.ts is what refuses it (#433).
  it("refuses a sign-up with a blank name", async () => {
    const email = `b-${Date.now()}@x.com`;
    await expect(
      auth.api.signUpEmail({
        body: { email, password: "Password1!", name: "   " },
      })
    ).rejects.toThrow();
    const rows = await db.select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(0);
  });

  it("stores a padded sign-up name trimmed", async () => {
    const email = `p-${Date.now()}@x.com`;
    await auth.api.signUpEmail({
      body: { email, password: "Password1!", name: "  Ada Lovelace  " },
    });
    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row.name).toBe("Ada Lovelace");
  });
});
