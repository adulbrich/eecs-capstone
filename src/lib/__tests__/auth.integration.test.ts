import { describe, expect, it } from "vitest";
import { auth } from "#/lib/auth";

const CONSOLE_EMAIL_URL = /^\s*\S[^\n]*?: (https?:\/\/\S+)$/m;

/**
 * Runs `fn` and pulls the link out of whatever the console transport printed.
 *
 * Matches on the rendered subject rather than a bracketed label: content moved
 * into `src/lib/email/templates.ts`, so the transport now prints the real
 * subject and body instead of a per-message tag and a `url:` field. The link
 * arrives inside the body as "<call to action>: <url>".
 */
async function captureStderr(fn: () => Promise<unknown>): Promise<string> {
  let captured = "";
  const orig = process.stderr.write.bind(process.stderr);
  process.stderr.write = ((chunk: unknown) => {
    captured += String(chunk);
    return true;
  }) as typeof process.stderr.write;
  try {
    await fn();
  } finally {
    process.stderr.write = orig;
  }
  return captured;
}

async function captureConsoleEmail(
  subject: string,
  fn: () => Promise<unknown>
): Promise<string> {
  const captured = await captureStderr(fn);
  if (!captured.includes(`subject: ${subject}`)) {
    throw new Error(
      `No console email with subject "${subject}". Got:\n${captured}`
    );
  }
  const match = captured.match(CONSOLE_EMAIL_URL);
  if (!match) {
    throw new Error(
      `Console email "${subject}" carried no link. Got:\n${captured}`
    );
  }
  return match[1];
}

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

    // Refused, and the refusal is what mails the second link. The callbackURL
    // in the body is what the link carries, and sign-in.tsx passes the same
    // value sign-up does, so the link lands on /verify-email rather than "/".
    const resendUrl = await captureConsoleEmail(
      "Verify your email",
      async () => {
        await expect(
          auth.api.signInEmail({
            body: { email, password, callbackURL: "/verify-email" },
          })
        ).rejects.toMatchObject({ body: { code: "EMAIL_NOT_VERIFIED" } });
      }
    );
    expect(new URL(resendUrl).searchParams.get("callbackURL")).toBe(
      "/verify-email"
    );
    expect(new URL(resendUrl).searchParams.get("token")).toBeTruthy();
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
