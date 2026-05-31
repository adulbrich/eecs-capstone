import { describe, expect, it } from "vitest";
import { auth } from "#/lib/auth";

async function captureConsoleEmail(
  label: string,
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
  const match = captured.match(
    new RegExp(`\\[${label}\\][\\s\\S]*?url: (https?://\\S+)`)
  );
  if (!match) {
    throw new Error(
      `No console email captured for ${label}. Got:\n${captured}`
    );
  }
  return match[1];
}

describe("auth integration", () => {
  it("signs up, verifies, signs in, reads session", async () => {
    const email = `it-${Date.now()}@example.com`;
    const password = "Password1!";

    const verifyUrl = await captureConsoleEmail("VERIFY EMAIL", async () => {
      await auth.api.signUpEmail({
        body: { email, password, name: "It User" },
      });
    });

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
