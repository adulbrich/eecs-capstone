import { describe, expect, it, vi } from "vitest";
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

  it("is not cleared by a request whose body does not parse", async () => {
    // The bypass this shape exists for, and it was a real one. Two APIError
    // classes are in play: the one `better-auth/api` exports, thrown by the
    // sign-in endpoint, and better-call's own, thrown when the body fails its
    // schema. An earlier version decided "not an instance of the first one,
    // therefore a success" and cleared the counter, so four wrong passwords
    // followed by one request with `password` omitted reset it, forever.
    const email = await aVerifiedUser();
    const address = anAddress();

    // One short of the limit, so the malformed request below is still served
    // rather than refused by the counter before its body is ever parsed.
    for (let attempt = 0; attempt < softLimit - 1; attempt += 1) {
      await signIn(email, WRONG, address);
    }

    const malformed = await auth.handler(
      new Request("http://localhost:3000/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "http://localhost:3000",
          "x-forwarded-for": address,
        },
        body: JSON.stringify({ email }),
      })
    );
    expect(malformed.status).toBe(400);

    // The malformed request neither counted nor cleared, so one more failure
    // reaches the limit and the attempt after it is refused. Against the bug
    // this replaces, the count would have been reset to one here and this last
    // attempt would have been a plain 401.
    expect((await signIn(email, WRONG, address)).status).toBe(401);
    expect((await signIn(email, WRONG, address)).status).toBe(429);
  });

  it("does not count a refused sign-in on an unverified account", async () => {
    // Somebody whose address is unverified signs in with the RIGHT password and
    // is refused, which is also what mails them a fresh verification link. That
    // is their only way back in, so counting it would throttle them out of
    // their own recovery. Only a wrong credential counts.
    const email = `unverified-${Date.now()}@example.com`;
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Unverified User" },
    });
    const address = anAddress();

    for (let attempt = 0; attempt <= softLimit + 1; attempt += 1) {
      const refused = await signIn(email, PASSWORD, address);
      expect(refused.status).not.toBe(429);
    }
  });

  it("lets the pair through again once the delay elapses", async () => {
    // The other half of the delay regression: an earlier version refused until
    // the failures aged out of the window, so this would have waited fifteen
    // minutes rather than the second configured here.
    const previous = process.env.SIGN_IN_SOFT_DELAY_SECONDS;
    process.env.SIGN_IN_SOFT_DELAY_SECONDS = "1";
    try {
      const email = await aVerifiedUser();
      const address = anAddress();
      for (let attempt = 0; attempt < softLimit; attempt += 1) {
        await signIn(email, WRONG, address);
      }
      expect((await signIn(email, WRONG, address)).status).toBe(429);

      await new Promise((resolve) => setTimeout(resolve, 1200));
      expect((await signIn(email, PASSWORD, address)).status).toBe(200);
    } finally {
      process.env.SIGN_IN_SOFT_DELAY_SECONDS = previous;
    }
  });

  it("logs a countable line per failure, with nothing identifying in it", async () => {
    // The fleet-wide spray count (#552). A per-pair counter cannot see one
    // guess made against each of ten thousand addresses, because no pair ever
    // reaches its limit; the volume of failures across the fleet is the only
    // thing that can. The line therefore has to exist, and it has to stay free
    // of the address and the email, which is what #559 is about. DEPLOYMENT.md
    // carries the Logs Insights query that counts it.
    const email = await aVerifiedUser();
    const address = anAddress();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      await signIn(email, WRONG, address);
      const lines = warn.mock.calls.map((call) => call.join(" "));
      const failures = lines.filter((line) =>
        line.includes("Failed sign-in recorded")
      );
      expect(failures).toHaveLength(1);
      for (const line of failures) {
        expect(line).not.toContain(email);
        expect(line).not.toContain(address);
      }
    } finally {
      warn.mockRestore();
    }
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
