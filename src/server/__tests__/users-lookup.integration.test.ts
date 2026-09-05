import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/schema";
import { auth } from "#/lib/auth";
import type { UserRole } from "#/lib/vocabularies";
import { lookupUserByEmailAs, searchUsersAs } from "../_internal/users";

async function makeUser(email: string, role: UserRole) {
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

const SIBLING_COUNT = 10;

describe("lookupUserByEmail", () => {
  it("finds an account that the search endpoint's result window drops", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`lookup-staff-${stamp}@x.com`, "instructor");
    const target = `zz-${stamp}@x.com`;
    const account = await makeUser(target, "user");
    // Every sibling address contains the target address as a substring and
    // sorts before it, so the search endpoint's ORDER BY email + LIMIT
    // window closes above the exact match. This is the shape the holder
    // dialog hit when it decided "no account" from search results.
    for (let i = 0; i < SIBLING_COUNT; i++) {
      await makeUser(`a${i}zz-${stamp}@x.com`, "user");
    }

    const searched = await searchUsersAs(staff, { q: target });
    expect(searched.some((r) => r.id === account.id)).toBe(false);

    const found = await lookupUserByEmailAs(staff, { email: target });
    expect(found?.id).toBe(account.id);
  });

  it("matches regardless of the case typed", async () => {
    // Scoped to this endpoint, which answers "does an account exist". The
    // write path's own resolution in resolveHold still compares the
    // address exactly, so a differently-cased address that reads as matched
    // here is stored without an account id.
    const stamp = Date.now();
    const staff = await makeUser(`case-staff-${stamp}@x.com`, "admin");
    const account = await makeUser(`case-target-${stamp}@x.com`, "user");

    const found = await lookupUserByEmailAs(staff, {
      email: `  CASE-Target-${stamp}@X.com  `,
    });
    expect(found?.id).toBe(account.id);
  });

  it("treats an underscore as a literal character, not a wildcard", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`wild-staff-${stamp}@x.com`, "admin");
    await makeUser(`axb-${stamp}@x.com`, "user");

    const found = await lookupUserByEmailAs(staff, {
      email: `a_b-${stamp}@x.com`,
    });
    expect(found).toBeNull();
  });

  it("returns null for an address with no account", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`none-staff-${stamp}@x.com`, "admin");
    const found = await lookupUserByEmailAs(staff, {
      email: `nobody-${stamp}@x.com`,
    });
    expect(found).toBeNull();
  });

  it("returns null for a blank address", async () => {
    const stamp = Date.now();
    const staff = await makeUser(`blank-staff-${stamp}@x.com`, "admin");
    expect(await lookupUserByEmailAs(staff, { email: "   " })).toBeNull();
  });

  it("forbids a non-staff viewer", async () => {
    const stamp = Date.now();
    const plain = await makeUser(`plain-lookup-${stamp}@x.com`, "user");
    await expect(
      lookupUserByEmailAs(plain, { email: `plain-lookup-${stamp}@x.com` })
    ).rejects.toThrow("Forbidden");
  });
});
