import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "#/db";
import { account, session, user } from "#/db/auth-schema";
import { auth } from "#/lib/auth";

// The `idp` check in `onid-profile.ts`, driven through the real ONID callback
// so that `onidUserInfo` in `src/lib/auth.ts` runs: the address release and
// Better Auth's link both sit behind the mapper, and only the full callback
// shows a refused token reaches neither.
//
// `auth.ts` builds its config from the environment at import, and CI's has no
// ONID variables, which would refuse every token as unconfigured and pass the
// refusal cases for the wrong reason. So the environment is set here, before
// the import, and each refusal case has a control that the same token without
// `idp` goes through.

const { TENANT, TOKEN_URL } = vi.hoisted(() => {
  const tenant = "ce6d05e1-3c5e-4d62-87a8-4c4a2713c113";
  process.env.ONID_DISCOVERY_URL = `https://login.microsoftonline.com/${tenant}/v2.0/.well-known/openid-configuration`;
  process.env.ONID_CLIENT_ID = "onid-id-fake";
  process.env.ONID_CLIENT_SECRET = "onid-secret-fake";
  return {
    TENANT: tenant,
    TOKEN_URL: `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
  };
});

const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const OTHER_TENANT_IDP =
  "https://sts.windows.net/0b7a1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d/";
const ORIGIN = "http://localhost:3000";
const BASE = `${ORIGIN}/api/auth`;

/** An unsigned ID token; the mapper decodes and does not verify. */
function idToken(payload: Record<string, unknown>): string {
  const b64 = (value: string) => Buffer.from(value).toString("base64url");
  return `${b64(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64(
    JSON.stringify({ iss: ISSUER, ...payload })
  )}.not-checked`;
}

/** The id_token the stubbed token endpoint hands back next. */
let nextIdToken = "";

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url === TOKEN_URL) {
        return Promise.resolve(
          Response.json({
            access_token: "access-token-fake",
            id_token: nextIdToken,
            token_type: "Bearer",
            expires_in: 3600,
          })
        );
      }
      return Promise.resolve(new Response("not stubbed", { status: 404 }));
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Starts an ONID sign-in and lands on the callback the way Entra would send
 * the browser back, with `token` as the ID token the exchange returns.
 */
async function signInWith(token: string): Promise<Response> {
  nextIdToken = token;
  const started = await auth.handler(
    new Request(`${BASE}/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ provider: "onid", callbackURL: "/" }),
    })
  );
  const { url } = (await started.json()) as { url: string };
  const query = new URLSearchParams({
    code: "code-fake",
    state: new URL(url).searchParams.get("state") ?? "",
  });
  const cookie = started.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  return auth.handler(
    new Request(`${BASE}/callback/onid?${query}`, { headers: { cookie } })
  );
}

let nextAddress = 0;
function anAddress(prefix: string): string {
  nextAddress += 1;
  return `${prefix}-${Date.now()}-${nextAddress}@oregonstate.edu`;
}

function tokenFor(email: string, extra: Record<string, unknown> = {}) {
  return idToken({
    oid: crypto.randomUUID(),
    sub: "pairwise-subject-for-this-app",
    email,
    given_name: "Token",
    family_name: "Holder",
    ...extra,
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

async function providersOf(userId: string): Promise<string[]> {
  const rows = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, userId));
  return rows.map((row) => row.providerId).sort();
}

async function sessionCount(userId: string): Promise<number> {
  const rows = await db
    .select({ id: session.id })
    .from(session)
    .where(eq(session.userId, userId));
  return rows.length;
}

async function aVerifiedRow(email: string): Promise<string> {
  await auth.api.createUser({
    body: { email, name: "Row Owner", data: { emailVerified: true } },
  });
  return (await rowFor(email)).id;
}

/** An unverified row with a password behind it, as production still holds. */
async function anUnverifiedRow(email: string): Promise<string> {
  await auth.api.createUser({
    body: { email, password: "Password1!", name: "Row Owner" },
  });
  return (await rowFor(email)).id;
}

describe("an ONID token whose idp names another tenant", () => {
  it("is not linked onto the verified row at its address", async () => {
    const refused = vi.spyOn(console, "error").mockImplementation(() => {
      // Silenced; the call is asserted below.
    });
    const email = anAddress("verified");
    const userId = await aVerifiedRow(email);

    const callback = await signInWith(
      tokenFor(email, { idp: OTHER_TENANT_IDP })
    );

    expect(callback.headers.get("location")).toContain("error");
    expect(refused).toHaveBeenCalledWith(
      expect.stringContaining("idp claim names another identity provider")
    );
    expect(await providersOf(userId)).toEqual([]);
    expect(await sessionCount(userId)).toBe(0);
  });

  it("links the same token without idp, so the refusal is the idp check", async () => {
    const email = anAddress("verified-control");
    const userId = await aVerifiedRow(email);

    const callback = await signInWith(tokenFor(email));

    expect(callback.headers.get("location")).not.toContain("error");
    expect(await providersOf(userId)).toEqual(["onid"]);
    expect(await sessionCount(userId)).toBe(1);
  });

  it("does not release the unverified row at its address", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {
      // Silenced; the verified case asserts the reason.
    });
    const email = anAddress("unverified");
    const userId = await anUnverifiedRow(email);

    const callback = await signInWith(
      tokenFor(email, { idp: OTHER_TENANT_IDP })
    );

    expect(callback.headers.get("location")).toContain("error");
    expect(await rowFor(email)).toEqual({
      id: userId,
      name: "Row Owner",
      emailVerified: false,
    });
    expect(await providersOf(userId)).toEqual(["credential"]);
    expect(await sessionCount(userId)).toBe(0);
  });

  it("releases the same row for the token without idp, so the refusal is the idp check", async () => {
    const email = anAddress("unverified-control");
    const userId = await anUnverifiedRow(email);

    const callback = await signInWith(tokenFor(email));

    expect(callback.headers.get("location")).not.toContain("error");
    expect(await rowFor(email)).toEqual({
      id: userId,
      name: "Token Holder",
      emailVerified: true,
    });
    expect(await providersOf(userId)).toEqual(["onid"]);
  });
});
