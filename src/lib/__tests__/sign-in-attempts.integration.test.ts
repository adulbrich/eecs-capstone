import { describe, expect, it } from "vitest";
import { auth } from "#/lib/auth";
import { signInLimits } from "#/lib/sign-in-limits";
import {
  attemptKey,
  checkSignInAllowed,
} from "#/server/_internal/sign-in-attempts";
import { captureConsoleEmail } from "#/test/shared/console-email";

// The per-account attempt counter (#552), end to end through the real `auth`
// object and a real database.
//
// The mechanism it depends on is Better Auth package internals: the endpoint
// throws an APIError on a failed sign-in, the router catches it, sets
// `context.returned` to it, and STILL runs after-hooks. Nothing in the docs
// promises that, so these cases exist to fail on a bump rather than let the
// counter quietly stop counting. `src/lib/auth.ts` already records that 1.7
// moves OAuth path shapes, which is the bump to re-check.

const { softLimit } = signInLimits();
const PASSWORD = "Password1!";
const WRONG = "definitely-not-the-password";

/** A fresh address per case, so one case cannot spend another's budget. */
let nextAddress = 0;
function anAddress(): string {
  nextAddress += 1;
  return `198.51.100.${nextAddress}`;
}

function signIn(email: string, password: string, address: string) {
  return auth.handler(
    new Request("http://localhost:3000/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3000",
        "x-forwarded-for": address,
      },
      body: JSON.stringify({ email, password }),
    })
  );
}

async function aVerifiedUser(): Promise<string> {
  const email = `attempts-${Date.now()}-${nextAddress}@example.com`;
  const verifyUrl = await captureConsoleEmail("Verify your email", async () => {
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Attempts User" },
    });
  });
  const token = new URL(verifyUrl).searchParams.get("token");
  await auth.api.verifyEmail({ query: { token: token as string } });
  return email;
}

describe("the sign-in attempt counter", () => {
  it("refuses the pair once the soft limit is reached, and says so", async () => {
    const email = await aVerifiedUser();
    const address = anAddress();

    for (let attempt = 0; attempt < softLimit; attempt += 1) {
      const refusedForPassword = await signIn(email, WRONG, address);
      expect(refusedForPassword.status).toBe(401);
    }

    const throttled = await signIn(email, WRONG, address);
    expect(throttled.status).toBe(429);
    const body = await throttled.json();
    expect(body.code).toBe("TOO_MANY_SIGN_IN_ATTEMPTS");
    expect(body.message).toContain("Too many sign-in attempts");

    // The refusal lands before the password is checked, so even the CORRECT
    // password is refused while the pair is throttled. That is the point: a
    // guesser gets no signal from the difference.
    const correctButThrottled = await signIn(email, PASSWORD, address);
    expect(correctButThrottled.status).toBe(429);
  });

  it("does not let one address lock another out of the same account", async () => {
    // The lockout-as-denial-of-service trap OWASP warns about. Keyed on the
    // account alone, anyone who knows an address could lock its owner out.
    const email = await aVerifiedUser();
    const attacker = anAddress();
    const owner = anAddress();

    for (let attempt = 0; attempt <= softLimit; attempt += 1) {
      await signIn(email, WRONG, attacker);
    }
    expect((await signIn(email, WRONG, attacker)).status).toBe(429);

    const ownerSignsIn = await signIn(email, PASSWORD, owner);
    expect(ownerSignsIn.status).toBe(200);
  });

  it("counts an address with no account, so a refusal reveals nothing", async () => {
    // If unknown addresses were skipped, being throttled would prove the
    // account exists, and the explicit "too many attempts" message would be an
    // enumeration oracle.
    const email = `no-such-user-${Date.now()}@example.com`;
    const address = anAddress();

    for (let attempt = 0; attempt < softLimit; attempt += 1) {
      expect((await signIn(email, WRONG, address)).status).toBe(401);
    }
    expect((await signIn(email, WRONG, address)).status).toBe(429);
  });

  it("clears the count when a sign-in succeeds", async () => {
    const email = await aVerifiedUser();
    const address = anAddress();
    const key = attemptKey(email, address);

    await signIn(email, WRONG, address);
    await signIn(email, WRONG, address);
    expect((await signIn(email, PASSWORD, address)).status).toBe(200);

    expect(await checkSignInAllowed(key.email, key.ip)).toEqual({
      allowed: true,
    });
    // And the cleared pair has its whole budget back rather than two fewer.
    for (let attempt = 0; attempt < softLimit; attempt += 1) {
      expect((await signIn(email, WRONG, address)).status).toBe(401);
    }
    expect((await signIn(email, WRONG, address)).status).toBe(429);
  });

  it("keys on the lowercased address, so case cannot bypass it", async () => {
    // Better Auth looks users up with `email.toLowerCase()`, so a counter that
    // did not would be bypassed by changing one letter.
    const email = await aVerifiedUser();
    const address = anAddress();

    for (let attempt = 0; attempt < softLimit; attempt += 1) {
      await signIn(email.toUpperCase(), WRONG, address);
    }
    expect((await signIn(email, WRONG, address)).status).toBe(429);
  });
});
