import { describe, expect, it } from "vitest";
import { auth } from "#/lib/auth";

// #576: password sign-in is gone, and the verification link went with it.
// Turning `emailAndPassword` off makes the sign-in and sign-up handlers refuse,
// but it does not un-mount them, and `/verify-email` does not check it at all:
// it would redeem any unexpired link Better Auth ever signed. So each path is a
// flat 404 through `disabledPaths`, and these cases are what notice one coming
// back, since "nothing calls it" is not "nothing reaches it".

const BASE = "http://localhost:3000/api/auth";

function post(path: string, body: Record<string, unknown> = {}) {
  return auth.handler(
    new Request(`${BASE}${path}`, {
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
      method: "POST",
    })
  );
}

describe("the retired password paths", () => {
  it.each([
    "/sign-in/email",
    "/sign-up/email",
    "/request-password-reset",
    "/reset-password",
    "/verify-password",
    "/change-password",
    "/send-verification-email",
  ])("answers 404 for %s", async (path) => {
    expect((await post(path)).status).toBe(404);
  });

  it("answers 404 for a verification link, however it was signed", async () => {
    // A GET, which is what a link in an old message is. It flipped
    // `emailVerified` without revoking a squatter's session, which is why it
    // is disabled rather than left to find no token.
    const response = await auth.handler(
      new Request(`${BASE}/verify-email?token=anything&callbackURL=%2F`)
    );
    expect(response.status).toBe(404);
  });

  it("does not sign in an account that still holds a password", async () => {
    // Production keeps the `credential` rows written before #576. The right
    // password for one of them has to be worth nothing now.
    const email = `it-legacy-${Date.now()}@example.com`;
    const password = "Password1!";
    await auth.api.createUser({
      body: {
        data: { emailVerified: true },
        email,
        name: "It Legacy",
        password,
      },
    });

    const response = await post("/sign-in/email", { email, password });

    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
