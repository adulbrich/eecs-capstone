import { eq, like } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "#/db";
import { account, session, user, verification } from "#/db/auth-schema";
import { projects, verificationSends } from "#/db/schema";
import { auth } from "#/lib/auth";
import { captureConsoleCode } from "#/test/shared/console-email";

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

async function sessionTokensOn(userId: string): Promise<string[]> {
  const rows = await db
    .select({ token: session.token })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.map((row) => row.token);
}

async function providersOn(userId: string): Promise<string[]> {
  const rows = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId));
  return rows.map((row) => row.providerId);
}

/**
 * An unverified row with a password behind it, which is what a squatter left.
 * Nobody can make one any more (#576), but production still holds the ones
 * made before, so the admin plugin's create stands in for the sign-up that
 * wrote them.
 */
async function aSquattedAddress(email: string): Promise<void> {
  await auth.api.createUser({
    body: { email, password: PASSWORD, name: "Squatter Name" },
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

    // A live session on the squatted row, which no flow here makes. It is
    // inserted so the revocation has something to revoke: asserting zero
    // sessions on a row that never had one proves nothing, and the criterion
    // names sessions as well as the password.
    await db.insert(session).values({
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86_400_000),
      id: `sess-${before?.id}`,
      token: `tok-${before?.id}`,
      updatedAt: new Date(),
      userId: before?.id as string,
    });
    expect(await sessionTokensOn(before?.id as string)).toEqual([
      `tok-${before?.id}`,
    ]);

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
    // And the squatter's session with it. Counting sessions would be the wrong
    // assertion: the row ends with one because this sign-in mints the OWNER's.
    // The token is what says whose.
    expect(await sessionTokensOn(after?.id as string)).not.toContain(
      `tok-${before?.id}`
    );
  });

  it("links the projects waiting on an unverified row once its code is redeemed", async () => {
    // A new row is claimed for at creation, but this one already existed, and
    // Better Auth flips its flag in place without a hook that claims. The
    // verification link used to be where these were claimed, and it went with
    // the password, so the redeem has to do it.
    const email = anAddress("waiting");
    await aSquattedAddress(email);
    const [project] = await db
      .insert(projects)
      .values({ proposerEmail: email, status: "draft", title: "Waiting" })
      .returning();

    const code = await sendCode(email);
    await auth.api.signInEmailOTP({
      body: { email, otp: code },
      headers: claimHeaders(email),
    });

    const [after] = await db
      .select({ proposerId: projects.proposerId })
      .from(projects)
      .where(eq(projects.id, project.id));
    expect(after.proposerId).toBe((await rowFor(email))?.id);
  });

  it("leaves a verified password account alone", async () => {
    const email = anAddress("verified");
    await auth.api.createUser({
      body: {
        email,
        name: "Verified Owner",
        password: PASSWORD,
        data: { emailVerified: true },
      },
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
    // `revokeUnprovenAccountAccess` no-ops on a verified row, so the
    // credential row survives. It is inert: the paths that read it are 404
    // since #576, which `auth.integration.test.ts` covers.
    expect(await providersOn(after?.id as string)).toEqual(["credential"]);
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

describe("a row a provider already owns", () => {
  /**
   * A verified row with a provider account and no credential, which is what
   * GitHub or ONID sign-up leaves behind. Inserted rather than driven, because
   * neither provider can be exercised from a test: `account.e2e.test.ts` says
   * the same about both.
   */
  async function aProviderRow(email: string, providerId: string) {
    const id = `otp-provider-${Date.now()}-${nextAddress}`;
    await db.insert(user).values({
      createdAt: new Date(),
      email,
      emailVerified: true,
      id,
      name: "Provider Owner",
      updatedAt: new Date(),
    });
    await db.insert(account).values({
      accountId: `${providerId}-${id}`,
      createdAt: new Date(),
      id: `acct-${id}`,
      providerId,
      updatedAt: new Date(),
      userId: id,
    });
    return id;
  }

  // The ordinary case, and the one nothing covered: somebody who signed up with
  // ONID or GitHub uses the code door at the same address later. It must work,
  // because they hold the inbox and the row is verified, and it must leave the
  // provider account alone. `revokeUnprovenAccountAccess` no-ops on a verified
  // row, so nothing is deleted today; this pins that, because the guard sits
  // right beside it and a change there could reach this row.
  it.each(["onid", "github"])(
    "signs in by code and leaves the %s account in place",
    async (providerId) => {
      const email = anAddress(`verified-${providerId}`);
      const id = await aProviderRow(email, providerId);

      const code = await sendCode(email);
      const response = await auth.api.signInEmailOTP({
        asResponse: true,
        body: { email, otp: code },
        headers: claimHeaders(email),
      });

      expect(response.headers.get("set-cookie")).toBeTruthy();
      expect(await providersOn(id)).toEqual([providerId]);
      const after = await rowFor(email);
      expect(after?.id).toBe(id);
      expect(after?.name).toBe("Provider Owner");
    }
  );

  // The unverified counterpart is refused, and that pair is the point: proving
  // the address proves the address. On a verified row it adds nothing anyone
  // did not already have; on an unverified one it would hand a second person a
  // session on a row the provider identity still opens.
  it("still refuses the unverified counterpart", async () => {
    const email = anAddress("unverified-provider");
    const id = await aProviderRow(email, "github");
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, id));

    const code = await sendCode(email);

    await expect(
      auth.api.signInEmailOTP({
        body: { email, otp: code },
        headers: claimHeaders(email),
      })
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
  });
});

describe("what the claim actually guarantees", () => {
  /**
   * The honest statement of #581, which is narrower than "the code cannot be
   * burned" and was written down that way after a correctness pass caught the
   * overclaim.
   *
   * A stranger CAN still burn a code. What they cannot do is burn one for
   * free: they have to ask for a code first, which is what earns them a claim,
   * and that ask comes out of the recipient's five an hour. Before this, three
   * POSTs did it with no send at all and no bound but the per-address rate
   * limit. Exhausting the send budget already locks somebody out of their own
   * mail, and ADR-0046 accepted that, so the attack is now no cheaper than a
   * denial this app had already priced in.
   */
  it("makes a stranger spend a send before they can spend a guess", async () => {
    const email = anAddress("priced");

    // No send, no claim, so the guesses are refused before Better Auth counts
    // them, and the owner's code survives.
    const owner = await sendCode(email);
    for (let guess = 0; guess < 4; guess += 1) {
      await expect(
        auth.api.signInEmailOTP({ body: { email, otp: "000000" } })
      ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
    }
    const survived = await auth.api.signInEmailOTP({
      asResponse: true,
      body: { email, name: "Unburned", otp: owner },
      headers: claimHeaders(email),
    });
    expect(survived.headers.get("set-cookie")).toBeTruthy();
  });

  it("lets a stranger who does send burn what that send created", async () => {
    const email = anAddress("burnable");

    // The stranger asks for a code. It goes to the address, not to them, but
    // the claim goes to them, and that is enough to spend the attempts.
    const strangerSend = await postSend(email);
    const strangerClaim = pairFrom(strangerSend.headers.get("set-cookie"));
    expect(strangerClaim).toContain("capstone_otp_claim=");

    for (let guess = 0; guess < 3; guess += 1) {
      await expect(
        auth.api.signInEmailOTP({
          body: { email, otp: "000000" },
          headers: new Headers({ cookie: strangerClaim as string }),
        })
      ).rejects.toMatchObject({ body: {} });
    }

    // Exhausted, and consumed. This is the cost the claim does NOT remove, and
    // the reason ADR-0047 states the guarantee as a price rather than as a
    // closure.
    await expect(
      auth.api.signInEmailOTP({
        body: { email, otp: "000000" },
        headers: new Headers({ cookie: strangerClaim as string }),
      })
    ).rejects.toMatchObject({ body: { code: "TOO_MANY_ATTEMPTS" } });
  });
});

describe("a code type this app does not serve", () => {
  // `type` is the caller's to choose, and every value but "sign-in" names a
  // different verification record. The guards key on the sign-in record, so a
  // handler reading another one was a way to spend guesses they never saw.
  it("refuses the send without writing a record", async () => {
    const email = anAddress("othertype");

    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth/email-otp/send-verification-otp`, {
        body: JSON.stringify({ email, type: "email-verification" }),
        headers: { "content-type": "application/json", origin: ORIGIN },
        method: "POST",
      })
    );

    expect(response.status).toBe(200);
    const [written] = await db
      .select({ id: verification.id })
      .from(verification)
      .where(like(verification.identifier, `%${email}`))
      .limit(1);
    expect(written).toBeUndefined();
  });

  it("refuses a guess against it", async () => {
    const email = anAddress("othertypeguess");

    await expect(
      auth.api.checkVerificationOTP({
        body: { email, otp: "000000", type: "email-verification" },
      })
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
  });
});

describe("the check path refuses the same rows the sign-in path does", () => {
  // The two have to agree, or the form accepts a code at step 2 and is refused
  // at step 3, and because the check does not consume, the person can loop
  // between those screens until the code expires.
  it.each([
    ["banned", true],
    ["provider-linked", false],
  ])("refuses a %s row", async (kind, banned) => {
    const email = anAddress(`check-${kind}`);
    await aSquattedAddress(email);
    const row = await rowFor(email);
    if (banned) {
      await db
        .update(user)
        .set({ banned: true })
        .where(eq(user.id, row?.id as string));
    } else {
      await db.insert(account).values({
        accountId: `gh-${row?.id}`,
        createdAt: new Date(),
        id: `acct-check-${row?.id}`,
        providerId: "github",
        updatedAt: new Date(),
        userId: row?.id as string,
      });
    }

    const code = await sendCode(email);

    await expect(
      auth.api.checkVerificationOTP({
        body: { email, otp: code, type: "sign-in" },
        headers: claimHeaders(email),
      })
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });
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

/**
 * Bodies Better Auth's own validation rejects, from a stranger (#576). Each case
 * was red before `isMalformedCodeRequest`; docs/QUIRKS.md says why.
 */
describe("requests Better Auth refuses", () => {
  function postRaw(
    path: string,
    body: Record<string, unknown>,
    cookie?: string
  ): Promise<Response> {
    return auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        body: JSON.stringify(body),
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          ...(cookie ? { cookie } : {}),
        },
        method: "POST",
      })
    );
  }

  async function sendsSpentBy(email: string): Promise<number> {
    const rows = await db
      .select({ id: verificationSends.id })
      .from(verificationSends)
      .where(eq(verificationSends.email, email.toLowerCase()));
    return rows.length;
  }

  it("spends nothing and hands out no claim for a send with no type", async () => {
    const email = anAddress("untyped");
    const code = await sendCode(email);
    expect(await sendsSpentBy(email)).toBe(1);

    const stranger = await postRaw("/email-otp/send-verification-otp", {
      email,
    });

    expect(stranger.status).toBe(400);
    expect(stranger.headers.get("set-cookie")).toBeNull();
    expect(await sendsSpentBy(email)).toBe(1);
    // And the owner's code is untouched, so it still signs them in.
    await auth.api.signInEmailOTP({
      body: { email, name: "Still Mine", otp: code },
      headers: claimHeaders(email),
    });
    expect((await rowFor(email))?.name).toBe("Still Mine");
  });

  it("spends none of the owner's budget on an address Better Auth rejects", async () => {
    const email = anAddress("padded");
    const limit = Number(process.env.SIGN_IN_CODE_LIMIT ?? 5);

    for (let sent = 0; sent < limit; sent += 1) {
      const padded = await postRaw("/email-otp/send-verification-otp", {
        email: ` ${email}`,
        type: "sign-in",
      });
      expect(padded.status).toBe(400);
    }

    // The cap key trims, so these used to count against the owner, and the
    // handler then mailed nothing: five requests, a silent hour's lockout.
    expect(await sendsSpentBy(email)).toBe(0);
    expect(await sendCode(email)).toHaveLength(6);
  });

  it("spends nothing on a send Better Auth refuses after the guard has run", async () => {
    // The endpoint's own cross-site check runs inside it, after every
    // before-hook, so the budget has already been reserved when it refuses.
    // Better Auth skips that check under a test runner (`skipOriginCheck`
    // defaults to true there), so it is switched back on for this one request.
    const email = anAddress("cross-site");
    await sendCode(email);
    const context = await auth.$context;
    const skipped = context.skipOriginCheck;
    context.skipOriginCheck = false;
    let refused: Response;
    try {
      refused = await auth.handler(
        new Request(`${ORIGIN}/api/auth/email-otp/send-verification-otp`, {
          body: JSON.stringify({ email, type: "sign-in" }),
          headers: {
            "content-type": "application/json",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "cross-site",
          },
          method: "POST",
        })
      );
    } finally {
      context.skipOriginCheck = skipped;
    }

    expect(refused.status).toBe(403);
    // No claim on the owner's live code, and the owner's one send is all that
    // is spent.
    expect(refused.headers.get("set-cookie")).toBeNull();
    expect(await sendsSpentBy(email)).toBe(1);
  });

  it("answers a redeem with a malformed name the same whether or not a code is outstanding", async () => {
    const live = anAddress("named");
    const idle = anAddress("unnamed");
    await sendCode(live);

    const withCode = await postRaw("/sign-in/email-otp", {
      email: live,
      name: 1,
      otp: "000000",
    });
    const withoutCode = await postRaw("/sign-in/email-otp", {
      email: idle,
      name: 1,
      otp: "000000",
    });

    const [a, b] = (await Promise.all([
      withCode.json(),
      withoutCode.json(),
    ])) as {
      code?: string;
    }[];
    expect(withCode.status).toBe(withoutCode.status);
    expect(a.code).toBe(b.code);
  });

  it("answers a redeem with no code the same whether or not one is outstanding", async () => {
    const live = anAddress("outstanding");
    const idle = anAddress("idle");
    await sendCode(live);

    const withCode = await postRaw("/sign-in/email-otp", { email: live });
    const withoutCode = await postRaw("/sign-in/email-otp", { email: idle });

    expect(withCode.status).toBe(withoutCode.status);
    const [a, b] = (await Promise.all([
      withCode.json(),
      withoutCode.json(),
    ])) as {
      code?: string;
    }[];
    expect(a.code).toBe(b.code);
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

  it("lets the owner recover when a stranger asked for the code first", async () => {
    const email = anAddress("strangerfirst");

    // Nobody can prove they own an address at send time, so a stranger can
    // always be the one who asks. The code still goes to the address, not to
    // them; what they hold is a claim on a record whose code they never see.
    const stranger = await sendAs(email);

    // The owner has the code, in a browser with no claim, and is refused. This
    // is the cost of the guard, and the next two steps are why it is bearable.
    await expect(
      auth.api.signInEmailOTP({ body: { email, otp: stranger.code } })
    ).rejects.toMatchObject({ body: { code: "INVALID_OTP" } });

    // Asking again is NOT gated on the claim, and that is deliberate. Gating it
    // was the first design and it turned one unauthenticated request into a
    // lockout: the owner's correct code was refused and their resend was
    // swallowed by the same rule.
    const owner = await sendAs(email);
    const response = await auth.api.signInEmailOTP({
      asResponse: true,
      body: { email, name: "Recovered Owner", otp: owner.code },
      headers: new Headers({ cookie: pairFrom(owner.cookie) as string }),
    });
    expect(response.headers.get("set-cookie")).toBeTruthy();

    // And the stranger's claim died with the record it named.
    expect(pairFrom(owner.cookie)).not.toBe(pairFrom(stranger.cookie));
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
