import { eq } from "drizzle-orm";
import { db } from "#/db";
import { account, user } from "#/db/auth-schema";

/**
 * Whether an emailed code must be refused for this address before Better Auth
 * acts on it (#576).
 *
 * Better Auth's `signInEmailOTP` calls `revokeUnprovenAccountAccess` on any
 * unverified row, then marks it verified, then mints a session. That helper is
 * looser than `releaseUnverifiedAddress`, which ADR-0045 wrote for the ONID
 * path: it refuses neither a banned row nor a row another provider is already
 * linked to. Both gaps are real, and neither is reachable from inside the
 * plugin, so this runs ahead of it.
 *
 * **A banned row.** The ban itself IS enforced, but too late to be harmless.
 * The admin plugin checks it in `databaseHooks.session.create.before`
 * (`better-auth/dist/plugins/admin/admin.mjs`), which runs after the credential
 * and the sessions have already been deleted and `emailVerified` has already
 * been flipped. So a code sign-in against a banned unverified row fails, and
 * still strips it. Nothing is granted, but a decision an admin made is quietly
 * rewritten, which is the same argument `releaseUnverifiedAddress` makes for
 * leaving a banned row alone.
 *
 * **A row with another provider linked.** This one grants something. A social
 * sign-up whose provider reported the address unverified leaves a row with a
 * provider account and `emailVerified` false. `revokeUnprovenAccountAccess`
 * deletes only `credential` accounts, so it deletes nothing here, and the code
 * sign-in then verifies that row and mints a session on it. The provider
 * identity is untouched and can still sign in, so one row now answers to two
 * people. Proving the address is good proof of the address and no proof at all
 * of the other identity.
 *
 * ## Why the refusal has to look like a wrong code
 *
 * The caller has offered no code yet, so a distinct refusal here would answer
 * "is there a banned or socially linked row at this address" to anyone who
 * asks, which is exactly the enumeration the send endpoint is careful not to
 * leak. Returning the shape of a wrong guess costs the refused person a clear
 * message, and in exchange the refusal is unobservable. The two populations it
 * turns away are small and both have a person to talk to: a banned user has an
 * admin, and a social user has the provider they signed up with.
 */
export async function otpSignInRefused(email: string): Promise<boolean> {
  // Better Auth lowercases `user.email` on every write path (docs/QUIRKS.md,
  // "Addresses are lowercase in the four columns we write"), and the body of a
  // sign-in request is whatever the person typed.
  const recipient = email.trim().toLowerCase();
  if (!recipient) {
    return false;
  }
  const [existing] = await db
    .select({
      banned: user.banned,
      emailVerified: user.emailVerified,
      id: user.id,
    })
    .from(user)
    .where(eq(user.email, recipient))
    .limit(1);
  // No row is the ordinary sign-up case, and a verified row is the ordinary
  // sign-in case. `revokeUnprovenAccountAccess` no-ops on a verified row, so
  // neither of the two problems above can arise there.
  if (!existing || existing.emailVerified) {
    return false;
  }
  if (existing.banned) {
    return true;
  }
  const accounts = await db
    .select({ providerId: account.providerId })
    .from(account)
    .where(eq(account.userId, existing.id));
  return accounts.some((row) => row.providerId !== "credential");
}
