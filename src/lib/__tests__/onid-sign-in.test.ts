import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAuthConfig } from "../_internal/auth-config";
import { onidProviderConfig } from "../_internal/onid-provider";

// #553: ONID sign-in must never fetch the discovery document; see
// `endpointsFromDiscoveryUrl` for why. This drives Better Auth's real handlers
// with the ONID entry `src/lib/auth.ts` uses, built by the same function from
// the same kind of environment, and counts every outbound fetch.
//
// Not `auth.ts` itself: it builds its auth object at module scope over the
// Drizzle adapter, so importing it needs a database. The memory adapter keeps
// this in the unit suite, the way `auth-rate-limits.test.ts` does, and the
// provider entry is the only part of the config under test.

const BASE_URL = "https://auth.test";
const TENANT = "ce6d05e1-3c5e-4d62-87a8-4c4a2713c113";
const ISSUER = `https://login.microsoftonline.com/${TENANT}/v2.0`;
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT}/oauth2/v2.0/token`;

const onid = buildAuthConfig({
  ONID_DISCOVERY_URL: DISCOVERY_URL,
  ONID_CLIENT_ID: "onid-id-fake",
  ONID_CLIENT_SECRET: "onid-secret-fake",
} as NodeJS.ProcessEnv).onid;

/** A stand-in for `onidUserInfo`, which reaches the database. */
const getUserInfo = vi.fn(() =>
  Promise.resolve({
    id: "8f1c9d0a-2b3e-4c5d-9e6f-7a8b9c0d1e2f",
    email: "benny.beaver@oregonstate.edu",
    emailVerified: true,
    name: "Benny Beaver",
  })
);

function buildAuth() {
  return betterAuth({
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
    }),
    baseURL: BASE_URL,
    secret: "onid-sign-in-test-secret-that-is-long-enough",
    plugins: [
      genericOAuth({ config: [onidProviderConfig(onid, getUserInfo)] }),
    ],
  });
}

/** Every URL `fetch` was asked for, in order. */
let fetched: string[];

beforeEach(() => {
  fetched = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      fetched.push(url);
      if (url === TOKEN_URL) {
        return Promise.resolve(
          Response.json({
            access_token: "access-token-fake",
            id_token: "id-token-fake",
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
  getUserInfo.mockClear();
});

/** POSTs the ONID button's request and returns the response. */
function signIn(auth: ReturnType<typeof buildAuth>): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/sign-in/oauth2`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE_URL },
      body: JSON.stringify({ providerId: "onid", callbackURL: "/" }),
    })
  );
}

/**
 * Signs in, then lands on the callback the way Entra would send the browser
 * back: the state from the authorize URL, the state cookie, a code, and any
 * extra query parameters.
 */
async function signInAndCallBack(
  auth: ReturnType<typeof buildAuth>,
  extra: Record<string, string> = {}
): Promise<Response> {
  const started = await signIn(auth);
  const { url } = (await started.json()) as { url: string };
  const query = new URLSearchParams({
    code: "code-fake",
    state: new URL(url).searchParams.get("state") ?? "",
    ...extra,
  });
  const cookie = started.headers
    .getSetCookie()
    .map((line) => line.split(";")[0])
    .join("; ");
  return auth.handler(
    new Request(`${BASE_URL}/api/auth/oauth2/callback/onid?${query}`, {
      headers: { cookie },
    })
  );
}

describe("ONID sign-in without discovery", () => {
  it("fetches nothing across two sign-ins and redirects to the derived authorize endpoint", async () => {
    const auth = buildAuth();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await signIn(auth);
      expect(response.status).toBe(200);
      const { url } = (await response.json()) as { url: string };
      const redirect = new URL(url);
      expect(`${redirect.origin}${redirect.pathname}`).toBe(AUTHORIZE_URL);
      expect(redirect.searchParams.get("client_id")).toBe("onid-id-fake");
      expect(redirect.searchParams.get("redirect_uri")).toBe(
        `${BASE_URL}/api/auth/oauth2/callback/onid`
      );
    }

    expect(fetched).toEqual([]);
  });

  it("fetches only the token endpoint across two consecutive sign-ins with their callbacks", async () => {
    const auth = buildAuth();

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const callback = await signInAndCallBack(auth);
      // A redirect back to the app, not to the error page: the callback got
      // all the way through the token exchange and our `getUserInfo`.
      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).not.toContain("error");
    }

    expect(getUserInfo).toHaveBeenCalledTimes(2);
    expect(fetched).toEqual([TOKEN_URL, TOKEN_URL]);
    expect(fetched).not.toContain(DISCOVERY_URL);
  });

  it("refuses the RFC 9207 iss parameter of another tenant if Entra sends one", async () => {
    // Discovery supplied the expected issuer for this check. Passing it
    // statically keeps the check running without the fetch, for the day Entra
    // sends `iss`; today it does not advertise that it will, and the tenant is
    // pinned by the `iss` claim check in `onidUserInfo`.
    const callback = await signInAndCallBack(buildAuth(), {
      iss: "https://login.microsoftonline.com/other-tenant/v2.0",
    });

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toContain("issuer_mismatch");
    expect(fetched).toEqual([]);
  });
});
