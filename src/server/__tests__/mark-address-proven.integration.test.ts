import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { user } from "#/db/auth-schema";
import { auth } from "#/lib/auth";
import { verificationMailLimits } from "#/lib/verification-mail-limits";
import { captureConsoleEmail } from "#/test/shared/console-email";

// A completed password reset is proof the person holds the inbox, and #554
// needs that recorded rather than merely true: without it the cap in piece D
// refuses the real owner the one message they need, which is the opposite of
// what the cap is for. The last case here is that whole path end to end.

const { limit } = verificationMailLimits();
const PASSWORD = "Password1!";
const NEW_PASSWORD = "BrandNewPass1!";

let nextAddress = 0;
function anAddress(prefix: string): string {
  nextAddress += 1;
  return `${prefix}-${Date.now()}-${nextAddress}@example.com`;
}

async function signUpUnverified(email: string, name: string): Promise<void> {
  await captureConsoleEmail("Verify your email", async () => {
    await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } });
  });
}

/** Asks for a reset and returns the token out of the mailed link. */
async function resetTokenFor(email: string): Promise<string> {
  const url = await captureConsoleEmail("Reset your password", async () => {
    await auth.api.requestPasswordReset({ body: { email } });
  });
  // The link is `/reset-password/<token>?callbackURL=`, so the token is the
  // last path segment rather than a query parameter.
  const token = new URL(url).pathname.split("/").pop();
  expect(token).toBeTruthy();
  return token as string;
}

async function verifiedFlagFor(email: string): Promise<boolean> {
  const [row] = await db
    .select({ emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return row.emailVerified;
}

describe("a completed password reset proves the address", () => {
  it("marks an unverified row verified", async () => {
    const email = anAddress("reset-proves");
    await signUpUnverified(email, "Real Owner");
    expect(await verifiedFlagFor(email)).toBe(false);

    await auth.api.resetPassword({
      body: { newPassword: NEW_PASSWORD, token: await resetTokenFor(email) },
    });

    expect(await verifiedFlagFor(email)).toBe(true);
  });

  it("lets the person sign in straight afterwards, with no second mail", async () => {
    const email = anAddress("reset-then-sign-in");
    await signUpUnverified(email, "Real Owner");
    await auth.api.resetPassword({
      body: { newPassword: NEW_PASSWORD, token: await resetTokenFor(email) },
    });

    // Before this hook existed the sign-in was refused with EMAIL_NOT_VERIFIED
    // and mailed a fresh link, which is the step that made recovery a maze.
    const signedIn = await auth.api.signInEmail({
      body: { email, password: NEW_PASSWORD },
    });
    expect(signedIn.user.email).toBe(email);
    expect(signedIn.user.emailVerified).toBe(true);
  });

  it("does not spend a recipient's mail allowance to recover an account", async () => {
    // The sequence ADR-0046 says the hook exists for. The squatter's sign-up
    // and sign-ins spend the whole hourly allowance, and the real owner then
    // has to be able to get in anyway.
    const victim = anAddress("squatted-recovery");
    await signUpUnverified(victim, "Squatter");
    for (let i = 0; i < limit - 1; i += 1) {
      await captureConsoleEmail("Verify your email", async () => {
        await expect(
          auth.api.signInEmail({ body: { email: victim, password: PASSWORD } })
        ).rejects.toMatchObject({ body: { code: "EMAIL_NOT_VERIFIED" } });
      });
    }

    // The allowance is gone, and a reset is deliberately not metered by it:
    // it is the recovery path, and capping it would lock out the one person
    // the cap exists to protect.
    await auth.api.resetPassword({
      body: { newPassword: NEW_PASSWORD, token: await resetTokenFor(victim) },
    });

    const signedIn = await auth.api.signInEmail({
      body: { email: victim, password: NEW_PASSWORD },
    });
    expect(signedIn.user.emailVerified).toBe(true);
    // And the squatter's password no longer works.
    await expect(
      auth.api.signInEmail({ body: { email: victim, password: PASSWORD } })
    ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
  });

  it("leaves an already verified row alone rather than claiming twice", async () => {
    const email = anAddress("already-verified");
    const verifyUrl = await captureConsoleEmail(
      "Verify your email",
      async () => {
        await auth.api.signUpEmail({
          body: { email, password: PASSWORD, name: "Real Owner" },
        });
      }
    );
    await auth.api.verifyEmail({
      query: {
        token: new URL(verifyUrl).searchParams.get("token") as string,
      },
    });

    // `markAddressProven` writes only when the flag is actually false, so an
    // ordinary reset by a verified person claims nothing a second time.
    await auth.api.resetPassword({
      body: { newPassword: NEW_PASSWORD, token: await resetTokenFor(email) },
    });

    expect(await verifiedFlagFor(email)).toBe(true);
  });
});
