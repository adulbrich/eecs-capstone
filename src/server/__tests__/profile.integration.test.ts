import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import { updateProfileImpl } from "#/server/_internal/profile";
import { profileSchema } from "#/server/profile";
import { sessionHeaders } from "#/test/shared/session";

/** A signed-in session for a fresh account, for the Better Auth own routes. */
async function signedInHeaders(email: string) {
  const { id } = await makeUser(email);
  return await sessionHeaders(id);
}

async function makeUser(email: string) {
  await auth.api.createUser({
    body: { email, name: email },
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

  // The form marks the field required, so this is an endpoint being called
  // directly. Better Auth validates `name` with a bare z.string(), which takes
  // "", and the create hook in src/lib/auth.ts is what refuses it (#433). The
  // admin plugin's create goes through the same hook as the code sign-in, so
  // it stands in for every way an account is made.
  it("refuses an account with a blank name", async () => {
    const email = `b-${Date.now()}@x.com`;
    await expect(
      auth.api.createUser({
        body: { email, name: "   " },
      })
    ).rejects.toThrow();
    const rows = await db.select().from(user).where(eq(user.email, email));
    expect(rows).toHaveLength(0);
  });

  // Creation being narrowed says nothing about `POST /update-user`, whose own
  // `name` is `z.any()`, or about the admin plugin's update, which takes an
  // open record. Both reach the column through the update hook (#433).
  it("refuses an update whose name is only spaces", async () => {
    const email = `u-${Date.now()}@x.com`;
    const headers = await signedInHeaders(email);
    await expect(
      auth.api.updateUser({ body: { name: "   " }, headers })
    ).rejects.toThrow();
    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row.name).toBe(email);
  });

  it("stores a padded update name trimmed", async () => {
    const email = `v-${Date.now()}@x.com`;
    const headers = await signedInHeaders(email);
    await auth.api.updateUser({ body: { name: "  Grace  " }, headers });
    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row.name).toBe("Grace");
  });

  // An update that never mentions the name must pass through, or every ban,
  // role change and verification flag would be judged on a field it does not
  // carry.
  it("lets an update that carries no name through", async () => {
    const email = `w-${Date.now()}@x.com`;
    const headers = await signedInHeaders(email);
    await auth.api.updateUser({ body: { image: "avatars/w.png" }, headers });
    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row.image).toBe("avatars/w.png");
    expect(row.name).toBe(email);
  });

  it("stores a padded account name trimmed", async () => {
    const email = `p-${Date.now()}@x.com`;
    await auth.api.createUser({
      body: { email, name: "  Ada Lovelace  " },
    });
    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row.name).toBe("Ada Lovelace");
  });
});
