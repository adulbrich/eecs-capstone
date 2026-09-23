import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { account, user } from "#/db/auth-schema";
import { auth } from "#/lib/auth";
import { captureConsoleCode } from "#/test/shared/console-email";

// #584: the code guard fails CLOSED. Its own file because the failure is a
// module mock, and in `email-otp.integration.test.ts` it would cover every
// case there.
vi.mock("#/server/_internal/otp-sign-in-guard", () => ({
  otpSignInRefused: vi.fn(() => {
    throw new Error("connection terminated unexpectedly");
  }),
}));

const ORIGIN = "http://localhost:3000";

let nextAddress = 0;
function anAddress(prefix: string): string {
  nextAddress += 1;
  return `otp-fail-${prefix}-${Date.now()}-${nextAddress}@example.com`;
}

/** Sends a code the way the form does, and returns it with the claim cookie. */
async function sendCode(
  email: string
): Promise<{ claim: Headers; code: string }> {
  let cookie = "";
  const code = await captureConsoleCode(async () => {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/email-otp/send-verification-otp`, {
        body: JSON.stringify({ email, type: "sign-in" }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      })
    );
    cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
  });
  return { claim: new Headers({ cookie }), code };
}

async function emailVerifiedFor(email: string): Promise<boolean | undefined> {
  const [row] = await db
    .select({ emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return row?.emailVerified;
}

describe("a code redeemed while the guard cannot read the row", () => {
  it("is refused, and leaves an unverified row another provider is linked to unverified", async () => {
    const email = anAddress("social");
    const created = await auth.api.createUser({
      body: { email, name: "Squatter Name", password: "Password1!" },
    });
    await db.insert(account).values({
      accountId: `gh-${created.user.id}`,
      createdAt: new Date(),
      id: `acct-fail-${created.user.id}`,
      providerId: "github",
      updatedAt: new Date(),
      userId: created.user.id,
    });

    const { claim, code } = await sendCode(email);

    // Failing open, this redeem verified the row with the GitHub identity
    // still on it: one row answering to two people.
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: code }, headers: claim })
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
    expect(await emailVerifiedFor(email)).toBe(false);
  });

  it("is refused for an ordinary new address too, because the whole guard fails closed", async () => {
    const email = anAddress("new");
    const { claim, code } = await sendCode(email);

    await expect(
      auth.api.checkVerificationOTP({
        body: { email, otp: code, type: "sign-in" },
        headers: claim,
      })
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
    expect(await emailVerifiedFor(email)).toBeUndefined();
  });
});
