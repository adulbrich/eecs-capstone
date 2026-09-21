import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins";
import { describe, expect, it } from "vitest";
import {
  authRateLimit,
  CHANGE_PASSWORD_MAX,
  GLOBAL_MAX,
  UNCHECKED_MAX,
} from "../_internal/auth-rate-limits";

// Better Auth turns its rate limiter on only under NODE_ENV=production, so
// nothing else in this repo exercises it and #520 shipped a wrong answer past
// a green CI. This builds a second, throwaway auth with the limiter forced on
// and the real rules from `auth-rate-limits.ts`, over the memory adapter so no
// database is involved and the file stays in the unit suite.
//
// The rate limiter runs in the router's `onRequest`, ahead of routing, body
// validation and the origin check, so an empty body is enough: every request
// below is counted whatever the endpoint then makes of it. That is also why
// no network call happens, even though `/sign-in/oauth2` would reach out to
// the identity provider on a well-formed request.

const BASE_URL = "https://auth.test";
const TRUSTED_PROXY = "10.0.0.0/16";

/**
 * The paths where no credential is checked, so they share one budget: the three
 * buttons on /sign-in, plus account creation. Better Auth's own default rule
 * covers all four at 3 per 10 seconds, which is the lockout being removed.
 */
const UNCHECKED_PATHS = [
  "/sign-in/email",
  "/sign-in/oauth2",
  "/sign-in/social",
  "/sign-up/email",
] as const;

/** Every path the rules name, for the "is this route real" cases below. */
const RULED_PATHS = [...UNCHECKED_PATHS, "/change-password"] as const;

// The memory rate-limit store is a module-level Map keyed on `ip|path`, shared
// by every auth instance in the process. Each case takes an address of its own
// so one case cannot spend another's budget.
let nextAddress = 0;
function anAddress(): string {
  nextAddress += 1;
  return `203.0.113.${nextAddress}`;
}

function buildAuth() {
  return betterAuth({
    database: memoryAdapter({}),
    baseURL: BASE_URL,
    secret: "rate-limit-test-secret-that-is-long-enough",
    emailAndPassword: { enabled: true },
    rateLimit: { ...authRateLimit, enabled: true },
    advanced: { ipAddress: { trustedProxies: [TRUSTED_PROXY] } },
    // Mounted so `/sign-in/oauth2` is a real route here, the way it is in
    // `src/lib/auth.ts`. The empty config means the handler refuses on an
    // unknown provider before it would fetch anything.
    plugins: [genericOAuth({ config: [] })],
  });
}

type Auth = ReturnType<typeof buildAuth>;

function call(
  auth: Auth,
  path: string,
  address: string,
  method: "GET" | "POST" = "POST"
): Promise<Response> {
  return auth.handler(
    new Request(`${BASE_URL}/api/auth${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        origin: BASE_URL,
        "x-forwarded-for": address,
      },
      ...(method === "POST" ? { body: "{}" } : {}),
    })
  );
}

describe("the budget for paths that check no credential", () => {
  it.each(UNCHECKED_PATHS)(
    "lets one address spend the whole budget on %s and refuses the next call",
    async (path) => {
      const auth = buildAuth();
      const address = anAddress();

      for (let spent = 0; spent < UNCHECKED_MAX; spent += 1) {
        const allowed = await call(auth, path, address);
        expect(allowed.status).not.toBe(429);
      }

      const refused = await call(auth, path, address);
      expect(refused.status).toBe(429);
    }
  );

  it("counts each path separately, so ONID does not spend GitHub's budget", async () => {
    const auth = buildAuth();
    const address = anAddress();

    for (let spent = 0; spent < UNCHECKED_MAX; spent += 1) {
      await call(auth, "/sign-in/oauth2", address);
    }

    const github = await call(auth, "/sign-in/social", address);
    expect(github.status).not.toBe(429);
  });
});

describe("the change-password budget", () => {
  // Its own, lower number, because unlike the paths above this one verifies the
  // current password and so is a real brute force surface. The case exists to
  // make the difference deliberate: a later pass that flattens all five paths
  // onto one budget fails here rather than reviewing cleanly.
  it("is smaller than the budget for paths that check no credential", () => {
    expect(CHANGE_PASSWORD_MAX).toBeLessThan(UNCHECKED_MAX);
  });

  it("lets one address spend it and refuses the next call", async () => {
    const auth = buildAuth();
    const address = anAddress();

    for (let spent = 0; spent < CHANGE_PASSWORD_MAX; spent += 1) {
      const allowed = await call(auth, "/change-password", address);
      expect(allowed.status).not.toBe(429);
    }

    const refused = await call(auth, "/change-password", address);
    expect(refused.status).toBe(429);
  });
});

describe("the paths the rules name", () => {
  // The rules are strings, and Better Auth matches them against the paths it
  // mounts. A version that renamed one would leave the rule pointing at
  // nothing and silently restore the 3-per-10-seconds default, which is the
  // lockout this exists to prevent. The genericOAuth comment in src/lib/auth.ts
  // records that 1.7 moves OAuth path shapes, which is the bump to re-check.
  //
  // The assertion is the exact 400 an empty body earns from a mounted route,
  // not `not 404`: a rule pointing at a path that no longer exists would leave
  // the request rate limited into a 429, which `not 404` would happily accept.
  it.each(RULED_PATHS)(
    "is a route Better Auth actually mounts: %s",
    async (path) => {
      const auth = buildAuth();
      const response = await call(auth, path, anAddress());
      expect(response.status).toBe(400);
    }
  );

  it("would notice a path that does not exist", async () => {
    const auth = buildAuth();
    const response = await call(auth, "/sign-in/not-a-real-path", anAddress());
    expect(response.status).toBe(404);
  });
});

describe("the session read", () => {
  it("is exempt, so a shared campus address can still render pages", async () => {
    const auth = buildAuth();
    const address = anAddress();
    const beyondTheGlobalBudget = GLOBAL_MAX + 50;

    for (let spent = 0; spent < beyondTheGlobalBudget; spent += 1) {
      const response = await call(auth, "/get-session", address, "GET");
      expect(response.status).not.toBe(429);
    }
  });
});
