import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "#/db";
import { verificationSends } from "#/db/schema";
import {
  verificationMailAllowed,
  verificationMailLimits,
} from "#/lib/verification-mail-limits";

/**
 * The queries behind the per-recipient cap on verification mail (#554). The
 * decision itself is in `src/lib/verification-mail-limits.ts`, which imports
 * nothing, so the numbers can be unit tested without a database.
 */

/** Normalised the one way Better Auth normalises an address. */
function recipientKey(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Takes one message out of an address's hourly allowance, and says whether
 * there was one to take.
 *
 * Reads and writes rather than only reading, which is why it is not called
 * `isAllowed`. Every caller is about to send, so counting at the decision is
 * the only way the count means anything; a separate `record` call would leave
 * a window where a failed send still spends nothing and a thrown error spends
 * twice.
 *
 * The check and the insert are two statements rather than one, so two requests
 * arriving in the same millisecond can both pass a cap of three at a count of
 * two and send a fourth. That is accepted: this bounds an amplifier, and one
 * extra message on a race is not the failure it exists to prevent. Making it
 * exact would want a unique index per (address, slot) or a serializable
 * transaction, both of which buy precision nobody needs at the cost of turning
 * a mail send into a retry loop. `sign_in_attempts` has the same shape.
 */
export async function reserveVerificationMail(email: string): Promise<boolean> {
  const limits = verificationMailLimits();
  const recipient = recipientKey(email);
  const [row] = await db
    .select({ sends: sql<string>`count(*)` })
    .from(verificationSends)
    .where(
      and(
        eq(verificationSends.email, recipient),
        gt(
          verificationSends.createdAt,
          sql`now() - make_interval(mins => ${limits.windowMinutes})`
        )
      )
    );
  if (!verificationMailAllowed(Number(row?.sends ?? 0), limits)) {
    return false;
  }
  await db.insert(verificationSends).values({ email: recipient });
  // Bounded to this recipient rather than the whole table so it stays on the
  // index and cannot turn a sign-up into a sequential scan. Rows for an address
  // that never appears again are left behind; they are two short columns and
  // nothing reads them, so a periodic sweep is not worth a scheduler. Same
  // reasoning as `recordFailedSignIn`.
  await db
    .delete(verificationSends)
    .where(
      and(
        eq(verificationSends.email, recipient),
        lt(
          verificationSends.createdAt,
          sql`now() - make_interval(mins => ${limits.windowMinutes})`
        )
      )
    );
  return true;
}
