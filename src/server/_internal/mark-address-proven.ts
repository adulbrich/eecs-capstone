import { and, eq } from "drizzle-orm";
import { db } from "#/db";
import { user } from "#/db/auth-schema";

/**
 * Records that somebody has just proved they hold a row's address, for the one
 * path that proves it without visiting the verification routes: a completed
 * password reset (#554).
 *
 * Better Auth's `reset-password` does not touch `emailVerified`, and #554 names
 * that as the reason recovery is a four-step maze rather than two: a person who
 * has just consumed a token mailed to their address is still refused at sign-in
 * as unverified, and has to wait for the link that refusal sends. A reset token
 * is the same proof a verification link is. It is generated only for an address
 * that already has a row, mailed to that address and nowhere else, and consumed
 * once. Someone who registered an address they do not own gains nothing from
 * this: the reset mail goes to the real owner, and they cannot read it.
 *
 * This matters more once the verification-mail cap exists. Without it, the
 * fourth message in an hour to a squatted address is the very one the real
 * owner needs after resetting, and D would refuse it: the cap would be bounding
 * their own way back in rather than the attacker's amplifier.
 *
 * Returns the row only when this call is what changed it, so the caller claims
 * projects once rather than on every reset a verified user performs.
 */
export async function markAddressProven(
  userId: string
): Promise<{ email: string } | null> {
  const [changed] = await db
    .update(user)
    .set({ emailVerified: true })
    .where(and(eq(user.id, userId), eq(user.emailVerified, false)))
    .returning({ email: user.email });
  return changed ?? null;
}
