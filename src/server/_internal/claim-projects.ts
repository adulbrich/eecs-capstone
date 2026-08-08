import { and, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { projects } from "#/db/schema";

/**
 * Links every unclaimed project whose proposer email matches `email` to
 * `userId`, and returns how many were claimed.
 *
 * Only ever called for an address whose owner has proven control of it.
 * Claiming on sign-up alone would let anyone take a colleague's projects by
 * registering at their address, so both call sites in `src/lib/auth.ts` gate on
 * verification.
 *
 * Idempotent: the `proposer_id is null` guard means a repeat call claims
 * nothing. Soft-deleted projects are claimed too, so restoring one does not
 * produce a project with no owner.
 */
export async function claimProjectsForVerifiedUser(
  userId: string,
  email: string
): Promise<number> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) {
    return 0;
  }
  const claimed = await db
    .update(projects)
    .set({ proposerId: userId })
    .where(
      and(
        isNull(projects.proposerId),
        // Case-insensitive on purpose. This will not use
        // projects_proposer_email_idx, which is on the raw column; at capstone
        // scale that costs nothing and correctness matters more.
        sql`lower(${projects.proposerEmail}) = ${normalized}`
      )
    )
    .returning({ id: projects.id });
  return claimed.length;
}
