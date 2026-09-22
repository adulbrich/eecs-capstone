import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { account, user } from "#/db/auth-schema";
import { auth } from "#/lib/auth";
import { releaseUnverifiedAddress } from "#/server/_internal/release-unverified-address";
import { captureConsoleEmail } from "#/test/shared/console-email";

// B1 of #554: an ONID sign-in takes an address away from a password account
// nobody has proven owns it. Driven through the extracted function rather than
// through the ONID callback, because the callback needs an Entra token this
// suite cannot mint; `src/lib/__tests__/onid-profile.test.ts` covers the mapper
// that calls it, and the wiring between the two is three lines in auth.ts.

const PASSWORD = "Password1!";

/** A fresh address per case, so one case cannot see another's row. */
let nextAddress = 0;
function anAddress(prefix: string): string {
  nextAddress += 1;
  return `${prefix}-${Date.now()}-${nextAddress}@oregonstate.edu`;
}

/** Signs up and leaves the account unverified, which is what a squatter has. */
async function aSquattedAddress(email: string): Promise<void> {
  await captureConsoleEmail("Verify your email", async () => {
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Squatter Name" },
    });
  });
}

async function rowFor(email: string) {
  const [row] = await db
    .select({
      id: user.id,
      name: user.name,
      emailVerified: user.emailVerified,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return row;
}

async function accountsFor(userId: string) {
  return await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId));
}

describe("releaseUnverifiedAddress", () => {
  it("deletes the password account, verifies the row and takes the name", async () => {
    const email = anAddress("squatted");
    await aSquattedAddress(email);
    const before = await rowFor(email);
    expect(before.emailVerified).toBe(false);
    expect(await accountsFor(before.id)).toHaveLength(1);

    const released = await releaseUnverifiedAddress(email, "Real Student");

    expect(released).toEqual({ userId: before.id });
    const after = await rowFor(email);
    expect(after.emailVerified).toBe(true);
    // The squatter chose "Squatter Name". Better Auth's link path would have
    // left it there, because `updateUserInfoOnLink` defaults to false.
    expect(after.name).toBe("Real Student");
    expect(await accountsFor(before.id)).toHaveLength(0);
  });

  it("matches on a folded address, because a UPN need not be lowercase", async () => {
    const email = anAddress("folded");
    await aSquattedAddress(email);

    const released = await releaseUnverifiedAddress(
      email.toUpperCase(),
      "Real Student"
    );

    expect(released).not.toBeNull();
    expect((await rowFor(email)).emailVerified).toBe(true);
  });

  it("leaves a verified row alone", async () => {
    const email = anAddress("verified");
    const verifyUrl = await captureConsoleEmail(
      "Verify your email",
      async () => {
        await auth.api.signUpEmail({
          body: { email, password: PASSWORD, name: "Verified Owner" },
        });
      }
    );
    const token = new URL(verifyUrl).searchParams.get("token") as string;
    await auth.api.verifyEmail({ query: { token } });

    const released = await releaseUnverifiedAddress(email, "Somebody Else");

    expect(released).toBeNull();
    const after = await rowFor(email);
    expect(after.name).toBe("Verified Owner");
    expect(await accountsFor(after.id)).toHaveLength(1);
  });

  it("leaves a row alone when a provider account is linked to it", async () => {
    const email = anAddress("linked");
    await aSquattedAddress(email);
    const row = await rowFor(email);
    // Stands in for a GitHub link on an unverified row. Whoever holds that
    // provider identity has authenticated as this user, so the row is not
    // unproven and B1 must not touch it.
    await db.insert(account).values({
      id: `it-github-${row.id}`,
      accountId: "github-12345",
      providerId: "github",
      userId: row.id,
    });

    const released = await releaseUnverifiedAddress(email, "Real Student");

    expect(released).toBeNull();
    const after = await rowFor(email);
    expect(after.emailVerified).toBe(false);
    expect(after.name).toBe("Squatter Name");
    expect(await accountsFor(row.id)).toHaveLength(2);
  });

  it("does nothing for an address no row holds", async () => {
    expect(
      await releaseUnverifiedAddress(anAddress("absent"), "Real Student")
    ).toBeNull();
  });
});
