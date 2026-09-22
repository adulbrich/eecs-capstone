import { eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { account, user, verification } from "#/db/auth-schema";
import { auth } from "#/lib/auth";
import {
  captureConsoleCode,
  captureConsoleEmail,
} from "#/test/shared/console-email";

// #576: the emailed sign-in code, and the four properties it exists for.
//
// The whole point is that no row is created for an address nobody has proved
// they hold, so most of these assert an ABSENCE. An absence passes for the
// wrong reason easily, so each case that looks for one also shows the same
// sequence producing the row when it should.

const PASSWORD = "Password1!";

let nextAddress = 0;
function anAddress(prefix: string): string {
  nextAddress += 1;
  return `otp-${prefix}-${Date.now()}-${nextAddress}@example.com`;
}

/**
 * The claim cookie the last send handed each address, which is what a browser
 * would be holding (#581).
 *
 * Every redeem below presents it. Without one the claim guard refuses before
 * Better Auth sees the code, which is the point of #581 and is covered on its
 * own further down; a case that means to exercise something else should not
 * accidentally be exercising that.
 */
const claims = new Map<string, string>();

/** Just the `name=value` pair, which is what a browser sends back. */
function pairFrom(setCookie: string | null): string | undefined {
  return setCookie?.split(";")[0];
}

/** The headers a browser that asked for this address's code would send. */
function claimHeaders(email: string): Headers | undefined {
  const cookie = claims.get(email);
  return cookie ? new Headers({ cookie }) : undefined;
}

const ORIGIN = "http://localhost:3000";

/**
 * A send, driven through the router rather than `auth.api`.
 *
 * It has to be the router. The guard short-circuits a send it will not act on
 * by throwing `APIError("OK", ...)`, which better-call's catch turns into a
 * 200; `auth.api.*` bypasses that catch and rethrows, so a case written against
 * it fails on the one path this file most needs to check.
 */
function postSend(email: string, cookie?: string): Promise<Response> {
  return auth.handler(
    new Request(`${ORIGIN}/api/auth/email-otp/send-verification-otp`, {
      body: JSON.stringify({ email, type: "sign-in" }),
      headers: {
        "content-type": "application/json",
        origin: ORIGIN,
        ...(cookie ? { cookie } : {}),
      },
      method: "POST",
    })
  );
}

async function sendCode(email: string): Promise<string> {
  return await captureConsoleCode(async () => {
    const response = await postSend(email, claims.get(email));
    const issued = pairFrom(response.headers.get("set-cookie"));
    if (issued) {
      claims.set(email, issued);
    }
  });
}

async function rowFor(email: string) {
  const [row] = await db
    .select({
      banned: user.banned,
      emailVerified: user.emailVerified,
      id: user.id,
      name: user.name,
    })
    .from(user)
    .where(eq(user.email, email))
    .limit(1);
  return row;
}

async function providersOn(userId: string): Promise<string[]> {
  const rows = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId));
  return rows.map((row) => row.providerId);
}

/** Signs up and leaves the account unverified, which is what a squatter has. */
async function aSquattedAddress(email: string): Promise<void> {
  await captureConsoleEmail("Verify your email", async () => {
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Squatter Name" },
    });
  });
}

describe("asking for a sign-in code", () => {
  it("creates no user row for an address nobody has proved they hold", async () => {
    const email = anAddress("unproven");

    const code = await sendCode(email);

    // The code exists, so the send really happened, and still no account. This
    // is the whole of #554's root cause: before this, the equivalent sequence
    // was `signUpEmail`, which created a permanent row on the spot.
    expect(code).toHaveLength(6);
    expect(await rowFor(email)).toBeUndefined();
  });

  it("creates the row only once the code is redeemed", async () => {
    const email = anAddress("redeemed");
    const code = await sendCode(email);
    expect(await rowFor(email)).toBeUndefined();

    await auth.api.signInEmailOTP({
      body: { email, name: "Proved Owner", otp: code },
      headers: claimHeaders(email),
    });

    const row = await rowFor(email);
    expect(row?.emailVerified).toBe(true);
    expect(row?.name).toBe("Proved Owner");
  });

  it("answers the same whether or not the address has an account", async () => {
    const known = anAddress("known");
    await aSquattedAddress(known);

    const forKnown = await auth.api.sendVerificationOTP({
      body: { email: known, type: "sign-in" },
    });
    const forUnknown = await auth.api.sendVerificationOTP({
      body: { email: anAddress("unknown"), type: "sign-in" },
    });

    expect(forKnown).toEqual(forUnknown);
  });

  it("stores the code so that reading the row does not reveal it", async () => {
    const email = anAddress("storage");

    const code = await sendCode(email);

    const [stored] = await db
      .select({ value: verification.value })
      .from(verification)
      .where(like(verification.identifier, `%${email}`))
      .limit(1);
    expect(stored?.value).toBeTruthy();
    // `storeOTP: "encrypted"`. The plain default would put the six digits in
    // this column, and `"hashed"` would put an unsalted SHA-256 of a six digit
    // space there, which is the same thing with extra steps.
    expect(stored?.value).not.toContain(code);
  });
});

describe("redeeming a code against a row that already exists", () => {
  it("takes the address off an unverified password account", async () => {
    const email = anAddress("squatted");
    await aSquattedAddress(email);
    const before = await rowFor(email);
    expect(before?.emailVerified).toBe(false);
    expect(await providersOn(before?.id as string)).toEqual(["credential"]);

    const code = await sendCode(email);
    await auth.api.signInEmailOTP({
      body: { email, name: "Real Owner", otp: code },
      headers: claimHeaders(email),
    });

    const after = await rowFor(email);
    expect(after?.id).toBe(before?.id);
    expect(after?.emailVerified).toBe(true);
    // The squatter's password is gone, which is what makes the row safe to
    // hand over rather than merely verified.
    expect(await providersOn(after?.id as string)).toEqual([]);
    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD } })
    ).rejects.toMatchObject({ body: {} });
  });

  it("leaves a verified password account alone", async () => {
    const email = anAddress("verified");
    const verifyUrl = await captureConsoleEmail(
      "Verify your email",
      async () => {
        await auth.api.signUpEmail({
          body: { email, name: "Verified Owner", password: PASSWORD },
        });
      }
    );
    await auth.api.verifyEmail({
      query: { token: new URL(verifyUrl).searchParams.get("token") as string },
    });
    const before = await rowFor(email);

    const code = await sendCode(email);
    const response = await auth.api.signInEmailOTP({
      asResponse: true,
      body: { email, otp: code },
      headers: claimHeaders(email),
    });

    expect(response.headers.get("set-cookie")).toBeTruthy();
    const after = await rowFor(email);
    expect(after?.id).toBe(before?.id);
    expect(after?.name).toBe("Verified Owner");
    // `revokeUnprovenAccountAccess` no-ops on a verified row, so the password
    // survives the cut-over and this person can still use it.
    expect(await providersOn(after?.id as string)).toEqual(["credential"]);
    const stillWorks = await auth.api.signInEmail({
      asResponse: true,
      body: { email, password: PASSWORD },
    });
    expect(stillWorks.headers.get("set-cookie")).toBeTruthy();
  });
});

describe("the two rows Better Auth's own helper does not refuse", () => {
  it("refuses a banned row, and leaves its credential in place", async () => {
    const email = anAddress("banned");
    await aSquattedAddress(email);
    const before = await rowFor(email);
    await db
      .update(user)
      .set({ banned: true })
      .where(eq(user.id, before?.id as string));

    const code = await sendCode(email);

    // Indistinguishable from a wrong code on purpose: the caller has offered no
    // code yet when the guard runs, so a distinct refusal would answer "is
    // there a banned row at this address" to anyone who asked.
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: code } })
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
    const after = await rowFor(email);
    expect(after?.emailVerified).toBe(false);
    // Without the guard this is `[]`: the strip happens before the admin
    // plugin's ban check, which runs on session creation.
    expect(await providersOn(after?.id as string)).toEqual(["credential"]);
  });

  it("refuses an unverified row another provider is linked to", async () => {
    const email = anAddress("social");
    await aSquattedAddress(email);
    const before = await rowFor(email);
    await db.insert(account).values({
      accountId: `gh-${before?.id}`,
      createdAt: new Date(),
      id: `acct-${before?.id}`,
      providerId: "github",
      updatedAt: new Date(),
      userId: before?.id as string,
    });

    const code = await sendCode(email);

    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: code } })
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
    // Proving the address proves the address, and nothing about the GitHub
    // identity on the row. Verifying here would leave one row answering to two
    // people, because the provider account survives the strip.
    expect((await rowFor(email))?.emailVerified).toBe(false);
  });
});

describe("the email-otp paths this app does not serve", () => {
  // `/email-otp/verify-email` is the one that matters: it flips emailVerified
  // without calling `revokeUnprovenAccountAccess`, so serving it would let the
  // real owner of a squatted address verify the squatter's row, which is #575
  // through a new door.
  const disabled = [
    "/email-otp/verify-email",
    "/email-otp/request-password-reset",
    "/email-otp/reset-password",
    "/forget-password/email-otp",
    "/email-otp/request-email-change",
    "/email-otp/change-email",
  ];

  it.each(disabled)("answers 404 for %s", async (path) => {
    const response = await auth.handler(
      new Request(`http://localhost:3000/api/auth${path}`, {
        body: "{}",
        headers: { "content-type": "application/json" },
        method: "POST",
      })
    );
    expect(response.status).toBe(404);
  });

  // This is the sequence `src/components/email-code-form.tsx` walks, and the
  // reason it can ask a new person for their name without burning their code.
  // `signInEmailOTP` would write `name: ""` and `requireUserName` would throw
  // AFTER consuming the code, leaving them holding one that no longer works.
  it("checks a code without spending it, so a new address can be asked for a name", async () => {
    const email = anAddress("mounted");
    const code = await sendCode(email);

    // Reports the missing account rather than succeeding. Safe to act on: only
    // somebody already holding the code can reach this answer, which is what
    // Better Auth's own comment on the branch says.
    await expect(
      auth.api.checkVerificationOTP({
        body: { email, otp: code, type: "sign-in" },
        headers: claimHeaders(email),
      })
    ).rejects.toMatchObject({ body: { code: "USER_NOT_FOUND" } });

    // The same code still works, which is the property the form depends on.
    await auth.api.signInEmailOTP({
      body: { email, name: "Asked For A Name", otp: code },
      headers: claimHeaders(email),
    });
    expect((await rowFor(email))?.name).toBe("Asked For A Name");
  });

  it("checks a code against an address that does have an account", async () => {
    const email = anAddress("existing");
    const first = await sendCode(email);
    await auth.api.signInEmailOTP({
      body: { email, name: "Returning Person", otp: first },
      headers: claimHeaders(email),
    });

    const second = await sendCode(email);
    const checked = await auth.api.checkVerificationOTP({
      body: { email, otp: second, type: "sign-in" },
      headers: claimHeaders(email),
    });

    expect(checked).toBeDefined();
    // Unspent here too, so the form redeems it on the next call rather than
    // asking for a code twice.
    const response = await auth.api.signInEmailOTP({
      asResponse: true,
      body: { email, otp: second },
      headers: claimHeaders(email),
    });
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });
});

describe("the per-recipient cap on sends", () => {
  it("stops mailing one address once its budget is gone", async () => {
    const email = anAddress("capped");
    const limit = Number(process.env.SIGN_IN_CODE_LIMIT ?? 5);

    for (let spent = 0; spent < limit; spent += 1) {
      await sendCode(email);
    }

    // Still 200 and still `{success: true}`, because saying otherwise would
    // tell a caller something about the recipient. The mail is what stops.
    const suppressed = await postSend(email, claims.get(email));
    expect(suppressed.status).toBe(200);
    expect(await suppressed.json()).toEqual({ success: true });
    await expect(sendCode(email)).rejects.toThrow(/No sign-in code/);
  });

  it("counts per recipient, so one address cannot spend another's", async () => {
    const spent = anAddress("spender");
    const other = anAddress("bystander");
    const limit = Number(process.env.SIGN_IN_CODE_LIMIT ?? 5);
    for (let sent = 0; sent < limit; sent += 1) {
      await sendCode(spent);
    }

    expect(await sendCode(other)).toHaveLength(6);
  });
});

describe("the claim that ties a code to the browser that asked for it", () => {
  /**
   * The send, keeping whatever cookie came back so a later call can present it.
   * A plain `auth.api` call drops the response headers, and the cookie IS the
   * thing under test here, so every case in this block goes through `handler`.
   */
  async function sendAs(
    email: string,
    cookie?: string
  ): Promise<{ code: string; cookie: string | null }> {
    let received: string | null = null;
    const code = await captureConsoleCode(async () => {
      const response = await postSend(email, cookie);
      received = response.headers.get("set-cookie");
    });
    return { code, cookie: received };
  }

  it("refuses a guess from a browser that did not ask for the code", async () => {
    const email = anAddress("claimed");
    const { code, cookie } = await sendAs(email);
    expect(pairFrom(cookie)).toContain("capstone_otp_claim=");

    // A stranger, holding no claim, spends what would have been the three
    // guesses. Each is refused before Better Auth counts one.
    for (let guess = 0; guess < 3; guess += 1) {
      await expect(
        auth.api.signInEmailOTP({ body: { email, otp: "000000" } })
      ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
    }

    // The owner's code still works, which is the whole of #581.
    const response = await auth.api.signInEmailOTP({
      asResponse: true,
      body: { email, name: "Claim Holder", otp: code },
      headers: new Headers({ cookie: pairFrom(cookie) as string }),
    });
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  it("does not let a second browser replace a live code", async () => {
    const email = anAddress("notstolen");
    const { code, cookie } = await sendAs(email);

    // A stranger asks for a code at the same address. Answered the same way
    // every send is answered, and it moves nothing.
    const stranger = await postSend(email);
    expect(stranger.status).toBe(200);
    // And no claim, which is the half that matters: a browser that could earn
    // one without moving the record could spend somebody else's guesses.
    expect(stranger.headers.get("set-cookie")).toBeNull();

    const response = await auth.api.signInEmailOTP({
      asResponse: true,
      body: { email, name: "Still Mine", otp: code },
      headers: new Headers({ cookie: pairFrom(cookie) as string }),
    });
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  it("lets the same browser ask again, and the newer code is the live one", async () => {
    const email = anAddress("resend");
    const first = await sendAs(email);
    const second = await sendAs(email, pairFrom(first.cookie));
    expect(second.code).not.toBe(first.code);

    // The rotation moved the expiry, so the first claim no longer matches and
    // the first code is gone with the record that held it.
    await expect(
      auth.api.signInEmailOTP({
        body: { email, otp: first.code },
        headers: new Headers({ cookie: pairFrom(first.cookie) as string }),
      })
    ).rejects.toMatchObject({ body: {} });

    const response = await auth.api.signInEmailOTP({
      asResponse: true,
      body: { email, name: "Resent", otp: second.code },
      headers: new Headers({ cookie: pairFrom(second.cookie) as string }),
    });
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });

  it("keeps a live code alive when the send budget runs out", async () => {
    const email = anAddress("budget");
    const limit = Number(process.env.SIGN_IN_CODE_LIMIT ?? 5);
    let held = await sendAs(email);
    for (let spent = 1; spent < limit; spent += 1) {
      held = await sendAs(email, pairFrom(held.cookie));
    }

    // The budget is gone, so this mails nothing. It must also leave the record
    // alone: `resolveOTP` rotates BEFORE the sender runs, so checking the cap
    // inside the sender left the person holding a dead code and no replacement.
    const refused = await postSend(email, pairFrom(held.cookie));
    expect(refused.status).toBe(200);

    const response = await auth.api.signInEmailOTP({
      asResponse: true,
      body: { email, name: "Budget Spent", otp: held.code },
      headers: new Headers({ cookie: pairFrom(held.cookie) as string }),
    });
    expect(response.headers.get("set-cookie")).toBeTruthy();
  });
});
