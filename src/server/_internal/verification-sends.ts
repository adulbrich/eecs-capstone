import { and, desc, eq, gt, lt, sql } from "drizzle-orm";
import { db } from "#/db";
import { verificationSends } from "#/db/schema";
import {
  type VerificationMailKind,
  verificationMailAllowed,
  verificationMailLimits,
} from "#/lib/verification-mail-limits";

/**
 * The queries behind the per-recipient cap on sign-in codes (#554, #576). The
 * decision itself is in `src/lib/verification-mail-limits.ts`, which imports
 * nothing, so the numbers can be unit tested without a database.
 */

/**
 * Normalised the one way Better Auth normalises an address: lowercased, not
 * trimmed. A padded address never gets here; the send guard leaves it for
 * Better Auth to reject.
 */
function recipientKey(email: string): string {
  return email.toLowerCase();
}

/** The one kind still written; see `VerificationMailKind`. */
const KIND: VerificationMailKind = "sign-in-code";

/**
 * Takes one sign-in code out of an address's hourly allowance, and says whether
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
 * a mail send into a retry loop.
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
        eq(verificationSends.kind, KIND),
        gt(
          verificationSends.createdAt,
          sql`now() - make_interval(mins => ${limits.windowMinutes})`
        )
      )
    );
  if (!verificationMailAllowed(Number(row?.sends ?? 0), limits)) {
    return false;
  }
  await db.insert(verificationSends).values({ email: recipient, kind: KIND });
  // Bounded to this recipient rather than the whole table so it stays on the
  // index and cannot turn a send into a sequential scan. Rows for an address
  // that never appears again are left behind; they are two short columns and
  // nothing reads them, so a periodic sweep is not worth a scheduler.
  await db
    .delete(verificationSends)
    .where(
      and(
        eq(verificationSends.email, recipient),
        eq(verificationSends.kind, KIND),
        lt(
          verificationSends.createdAt,
          sql`now() - make_interval(mins => ${limits.windowMinutes})`
        )
      )
    );
  return true;
}

/**
 * Gives back the allowance `reserveVerificationMail` took, for a send that then
 * failed.
 *
 * The reservation has to come before the send, because the send rotates the
 * record before it mails and a refusal after that would kill the code the
 * person already holds. But Better Auth still has checks of its own inside the
 * endpoint, after the reservation: its cross-site check, for one. A send it
 * refuses there rotates nothing and mails nothing, so without this, five of
 * them spent a stranger's whole hour in silence (#576).
 *
 * The newest row for the recipient, not necessarily the one this request wrote;
 * two sends to one address at once can swap which row each gives back, and the
 * count comes out the same.
 */
export async function refundVerificationMail(email: string): Promise<void> {
  const [newest] = await db
    .select({ id: verificationSends.id })
    .from(verificationSends)
    .where(
      and(
        eq(verificationSends.email, recipientKey(email)),
        eq(verificationSends.kind, KIND)
      )
    )
    .orderBy(desc(verificationSends.createdAt))
    .limit(1);
  if (newest) {
    await db
      .delete(verificationSends)
      .where(eq(verificationSends.id, newest.id));
  }
}
