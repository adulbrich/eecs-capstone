import { eq } from "drizzle-orm";
import { db } from "#/db";
import { account, session, user } from "#/db/auth-schema";

/**
 * Takes an address away from a password account nobody has proven owns it, so
 * that ONID can have it (#554, piece B1).
 *
 * The problem this solves is one fact with several symptoms: sign-up is open,
 * so anyone can register `student@oregonstate.edu` with a password of their
 * choosing, and the row they create then owns that address. The expensive
 * symptom is ONID. `accountLinking.requireLocalEmailVerified` defaults to true
 * and `src/lib/auth.ts` deliberately leaves it there, so the guard in
 * `better-auth/dist/oauth2/link-account.mjs` refuses to link an authenticated
 * ONID identity into an unverified row and the student gets `account not
 * linked` on their first sign-in. At term start that is a student who simply
 * cannot get in, and they did nothing wrong.
 *
 * Why taking the address is right, when the comment on `accountLinking` argues
 * the other way: that comment refuses the NAIVE version, linking into the
 * unverified row and leaving the password in place, and it is right to. Whoever
 * set that password would inherit an account the university has now vouched
 * for. Deleting the credential removes that entirely, and the proof of
 * ownership is not close: OSU has just interactively authenticated the person
 * against the tenant `onid-profile.ts` pins, with whatever MFA the university
 * enforces, which is strictly stronger than a link we mailed to the address
 * ourselves. Nobody can obtain an ONID identity for somebody else's address.
 *
 * The two writes are one transaction, and the credential goes FIRST. The
 * reverse order with a failure in between would leave a verified account whose
 * password a stranger knows, which is precisely the takeover this exists to
 * prevent, so the ordering is load-bearing rather than tidiness.
 *
 * ADR-0045 is the decision, including what it does not fix.
 *
 * Deliberately narrow. Anything other than a `credential` account on the row
 * means somebody has authenticated as this user through a provider, so the row
 * is not unproven and this returns without writing. The ONID sign-in then fails
 * the way it does today, which is the safe status quo rather than a regression.
 */
export interface AddressRelease {
  /** The row the address was taken from, once it has been taken. */
  userId: string;
}

export async function releaseUnverifiedAddress(
  email: string,
  onidName: string
): Promise<AddressRelease | null> {
  // Better Auth lowercases `user.email` on every write path (docs/QUIRKS.md,
  // "Addresses are lowercase in the four columns we write"), and the UPN a
  // token carries is not guaranteed to be folded, so fold it here rather than
  // miss a row on a capital letter.
  const recipient = email.trim().toLowerCase();
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        banned: user.banned,
        emailVerified: user.emailVerified,
        id: user.id,
      })
      .from(user)
      .where(eq(user.email, recipient))
      .limit(1);
    if (!existing || existing.emailVerified) {
      return null;
    }
    // A banned row is left alone, and this is the one refusal that costs a real
    // student something. Releasing would hand them an account an admin has shut,
    // which is a worse dead end than `account not linked`, and clearing the ban
    // here would silently overturn a decision a person made without that person
    // ever seeing it happen. Neither is this function's call. The student gets
    // today's behaviour and an admin can unban or delete the row; nothing else
    // in the app resolves a ban automatically either.
    if (existing.banned) {
      return null;
    }
    const accounts = await tx
      .select({ providerId: account.providerId })
      .from(account)
      .where(eq(account.userId, existing.id));
    if (accounts.some((row) => row.providerId !== "credential")) {
      return null;
    }
    await tx.delete(account).where(eq(account.userId, existing.id));
    // No session can exist on this row today: `requireEmailVerification` makes
    // sign-up skip auto sign-in, and sign-in refuses an unverified address, so
    // nobody has ever held one. This runs anyway because it costs one statement
    // and the thing it guards against is the whole point of the function: if
    // that configuration ever changes, a squatter's live session would survive
    // into an account the student now owns.
    await tx.delete(session).where(eq(session.userId, existing.id));
    await tx
      .update(user)
      .set({
        emailVerified: true,
        // The squatter chose this row's name, and nothing else overwrites it:
        // `accountLinking.updateUserInfoOnLink` defaults to false, so Better
        // Auth's link path leaves `name` alone and a student would otherwise
        // inherit a stranger's display name.
        name: onidName,
      })
      .where(eq(user.id, existing.id));
    return { userId: existing.id };
  });
}
