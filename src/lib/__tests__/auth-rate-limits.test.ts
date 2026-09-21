import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { genericOAuth } from "better-auth/plugins";
import { describe, expect, it, vi } from "vitest";
import {
  authRateLimit,
  CHANGE_PASSWORD_MAX,
  GLOBAL_MAX,
  UNCHECKED_MAX,
  UNRULED_BY_DESIGN,
  WINDOW_SECONDS,
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
 * The paths where no credential is checked, so they share one budget: the two
 * OAuth buttons on /sign-in, plus account creation. Better Auth's own default
 * rule covers all three at 3, which is the refusal being removed. Not "3 per 10
 * seconds": see "what a max actually means" below.
 */
const UNCHECKED_PATHS = [
  "/sign-in/oauth2",
  "/sign-in/social",
  "/sign-up/email",
] as const;

/** Every path the rules name, for the "is this route real" cases below. */
const RULED_PATHS = [
  ...UNCHECKED_PATHS,
  "/change-password",
  "/get-session",
] as const;

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

/** Only `handler` is used, and typing it to one instance's shape would make
 * every other `betterAuth` in this file unassignable. */
interface Handler {
  handler: (request: Request) => Promise<Response>;
}

function call(
  auth: Handler,
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
  // Its own, lower number, because the legitimate call rate is near zero:
  // sign-in and sign-up have to tolerate a lecture hall arriving at once and
  // this does not. The case exists to make the difference deliberate, so a
  // later pass that flattens every path onto one budget fails here rather than
  // reviewing cleanly.
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
      const isRead = path === "/get-session";
      const response = await call(
        auth,
        path,
        anAddress(),
        isRead ? "GET" : "POST"
      );
      // A mounted POST route rejects the empty body with 400; the session read
      // is a GET and answers 200 with a null session. Either way, not 404 and
      // not 429.
      expect(response.status).toBe(isRead ? 200 : 400);
    }
  );

  it("would notice a path that does not exist", async () => {
    const auth = buildAuth();
    const response = await call(auth, "/sign-in/not-a-real-path", anAddress());
    expect(response.status).toBe(404);
  });
});

describe("the paths left on Better Auth's default", () => {
  // `/sign-in/email` is the interesting one. Raising it alongside the others
  // would be consistent and is wrong, because `emailVerification.sendOnSignIn`
  // makes the route limit double as the ceiling on verification mail aimed at
  // a stranger's inbox (#554). This case is what makes that a decision rather
  // than an oversight: adding a rule for it turns the test red, and whoever
  // does it has to come here and read why.
  it("does not quietly gain a rule", () => {
    const ruled = Object.keys(authRateLimit.customRules ?? {});
    for (const path of UNRULED_BY_DESIGN) {
      expect(ruled).not.toContain(path);
    }
  });

  it.each(UNRULED_BY_DESIGN)(
    "is still a mounted route, so the default actually applies to it: %s",
    async (path) => {
      // "Nothing calls it" is not "nothing reaches it". `/change-email` in
      // particular is mounted whatever `user.changeEmail` says, so a direct
      // call is served and counted, and leaving it on the default is a choice
      // rather than a non-event.
      const auth = buildAuth();
      const response = await call(auth, path, anAddress());
      expect(response.status).toBe(400);
    }
  );

  it("still refuses /sign-in/email at Better Auth's default of 3", async () => {
    const auth = buildAuth();
    const address = anAddress();
    const betterAuthSignInDefault = 3;

    for (let spent = 0; spent < betterAuthSignInDefault; spent += 1) {
      const allowed = await call(auth, "/sign-in/email", address);
      expect(allowed.status).not.toBe(429);
    }

    const refused = await call(auth, "/sign-in/email", address);
    expect(refused.status).toBe(429);
  });
});

describe("what a max actually means", () => {
  // Better Auth clears a count only after a gap longer than the window with no
  // ACCEPTED request, and every accepted request pushes that gap out. So a max
  // is a budget between lulls, not a rate: a trickle far under the nominal rate
  // still accumulates to the max and is then refused. Every number in
  // auth-rate-limits.ts has to be read that way, and this case is here so the
  // next person to write "60 per 10 seconds" in a comment finds out otherwise.
  it("is a budget between lulls, not a rate", async () => {
    const max = 10;
    // Half the rate this rule nominally allows, so a rate-shaped limiter would
    // never refuse it. Fake timers, because the point is a ten-second window
    // and nothing here needs to actually wait.
    const gapMs = (WINDOW_SECONDS / max) * 2 * 1000;
    const auth = betterAuth({
      database: memoryAdapter({}),
      baseURL: BASE_URL,
      secret: "rate-limit-test-secret-that-is-long-enough",
      emailAndPassword: { enabled: true },
      advanced: { ipAddress: { trustedProxies: [TRUSTED_PROXY] } },
      rateLimit: {
        enabled: true,
        window: WINDOW_SECONDS,
        max,
        customRules: {
          "/sign-in/email": { window: WINDOW_SECONDS, max },
        },
      },
    });
    const address = anAddress();
    const statuses: number[] = [];

    vi.useFakeTimers();
    try {
      for (let sent = 0; sent <= max; sent += 1) {
        statuses.push((await call(auth, "/sign-in/email", address)).status);
        vi.setSystemTime(Date.now() + gapMs);
      }

      expect(statuses.slice(0, max)).not.toContain(429);
      expect(statuses.at(-1)).toBe(429);

      // Falling quiet for longer than the window clears it.
      vi.setSystemTime(Date.now() + (WINDOW_SECONDS + 1) * 1000);
      const afterTheLull = await call(auth, "/sign-in/email", address);
      expect(afterTheLull.status).not.toBe(429);
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts against the window the module declares", () => {
    expect(authRateLimit.window).toBe(WINDOW_SECONDS);
    for (const rule of Object.values(authRateLimit.customRules ?? {})) {
      // `false` disables a path and a function resolves per request; neither
      // carries a window of its own.
      if (typeof rule === "object") {
        expect(rule.window).toBe(WINDOW_SECONDS);
      }
    }
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
