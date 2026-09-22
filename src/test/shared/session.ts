/**
 * A signed-in session for the integration suite, without a sign-in.
 *
 * The suite used to get one by signing up with a password and signing in with
 * it. There is no password any more (#576), and going through the emailed code
 * instead would put a send, a claim cookie and a decryption in front of every
 * test that only wants to call an endpoint as somebody. What those tests are
 * about is the endpoint, so this writes the session row Better Auth would have
 * written and signs its cookie the way Better Auth would have signed it. The
 * code sign-in itself is covered where it is the subject, in
 * `email-otp.integration.test.ts`.
 */
import { makeSignature } from "better-auth/crypto";
import { auth } from "#/lib/auth";

/** Request headers carrying a live session for `userId`. */
export async function sessionHeaders(userId: string): Promise<Headers> {
  const ctx = await auth.$context;
  const { token } = await ctx.internalAdapter.createSession(userId);
  const signed = `${token}.${await makeSignature(token, ctx.secret)}`;
  return new Headers({
    cookie: `${ctx.authCookies.sessionToken.name}=${encodeURIComponent(signed)}`,
  });
}
