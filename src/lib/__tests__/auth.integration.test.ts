import { describe, expect, it } from "vitest";
import { auth } from "#/lib/auth";
import {
  captureConsoleEmail,
  captureStderr,
} from "#/test/shared/console-email";

describe("auth integration", () => {
  it("signs up, verifies, signs in, reads session", async () => {
    const email = `it-${Date.now()}@example.com`;
    const password = "Password1!";

    const verifyUrl = await captureConsoleEmail(
      "Verify your email",
      async () => {
        await auth.api.signUpEmail({
          body: { email, password, name: "It User" },
        });
      }
    );

    const token = new URL(verifyUrl).searchParams.get("token");
    expect(token).toBeTruthy();
    // Set by `sendVerificationEmail`, not by the caller: sign-up.tsx sends no
    // callbackURL, and Better Auth's own default would be "/".
    expect(new URL(verifyUrl).searchParams.get("callbackURL")).toBe(
      "/verify-email"
    );

    await auth.api.verifyEmail({ query: { token: token as string } });

    const signInResponse = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const cookie = signInResponse.headers.get("set-cookie");
    expect(cookie).toBeTruthy();

    const session = await auth.api.getSession({
      headers: new Headers({ cookie: cookie as string }),
    });
    expect(session?.user.email).toBe(email);
    expect(session?.user.emailVerified).toBe(true);
    expect(session?.user.role).toBe("user");
  });

  it("re-mails the verification link when an unverified account signs in", async () => {
    const email = `it-unverified-${Date.now()}@example.com`;
    const password = "Password1!";
    await captureConsoleEmail("Verify your email", async () => {
      await auth.api.signUpEmail({
        body: { email, password, name: "It Unverified" },
      });
    });

    // Refused, and the refusal is what mails the second link. No callbackURL
    // in the body, exactly as sign-in.tsx sends it: the link still has to land
    // on /verify-email, because `sendVerificationEmail` sets that rather than
    // the caller (#254).
    const resendUrl = await captureConsoleEmail(
      "Verify your email",
      async () => {
        await expect(
          auth.api.signInEmail({ body: { email, password } })
        ).rejects.toMatchObject({ body: { code: "EMAIL_NOT_VERIFIED" } });
      }
    );
    expect(new URL(resendUrl).searchParams.get("callbackURL")).toBe(
      "/verify-email"
    );
    expect(new URL(resendUrl).searchParams.get("token")).toBeTruthy();
  });

  it("does not turn a successful sign-in into a redirect", async () => {
    // #254: a callbackURL in the sign-in body comes back as `redirect: true`
    // on the success path too, and the client's redirect plugin follows it,
    // racing the sign-in route's own navigate. Nothing may set it now, so the
    // answer to a plain sign-in has to carry no redirect at all.
    const email = `it-noredirect-${Date.now()}@example.com`;
    const password = "Password1!";
    const verifyUrl = await captureConsoleEmail(
      "Verify your email",
      async () => {
        await auth.api.signUpEmail({
          body: { email, password, name: "It Redirect" },
        });
      }
    );
    const token = new URL(verifyUrl).searchParams.get("token");
    await auth.api.verifyEmail({ query: { token: token as string } });

    const response = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    const body = (await response.json()) as { redirect?: boolean };
    expect(body.redirect).toBe(false);
    expect(response.headers.get("location")).toBeNull();
  });

  it("mails nothing when the password is wrong, verified or not", async () => {
    const email = `it-wrongpw-${Date.now()}@example.com`;
    await captureConsoleEmail("Verify your email", async () => {
      await auth.api.signUpEmail({
        body: { email, password: "Password1!", name: "It Wrong" },
      });
    });

    const captured = await captureStderr(async () => {
      await expect(
        auth.api.signInEmail({
          body: { email, password: "Wrong1!", callbackURL: "/verify-email" },
        })
      ).rejects.toMatchObject({ body: { code: "INVALID_EMAIL_OR_PASSWORD" } });
    });
    expect(captured).not.toContain("subject: Verify your email");
  });
});
