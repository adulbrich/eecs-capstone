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
async function captureConsoleEmail(
  subject: string,
  fn: () => Promise<unknown>
): Promise<string> {
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
});
