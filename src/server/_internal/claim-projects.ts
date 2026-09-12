import { and, isNull, sql } from "drizzle-orm";
import { db } from "#/db";
import { notifications, projects } from "#/db/schema";
import { projectsClaimedNotification } from "#/lib/project-notifications";

/**
 * Links every unclaimed project whose proposer email matches `email` to
 * `userId`, and returns how many were claimed.
 *
 * The two call sites in `src/lib/auth.ts` both gate on a verified address,
 * which is the point: claiming on sign-up alone would let anyone take a
 * colleague's projects by registering at their address.
 *
 * That gate is not a universal invariant, though, and this function must not be
 * written as if it were. Better Auth's admin plugin accepts an open `data`
 * record on create-user, so an admin can set `emailVerified: true` for an
 * address nobody has proven, and the create hook will claim for it. That is
 * acceptable only because an admin is already trusted with far more; it is not
 * acceptable to add a third caller on the same reasoning. Any new call site
 * must be able to name the proof of ownership it relies on.
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
  // In-app only: the person just proved they own this address by reading an
  // email at it, so another one would tell them what they already know. The
  // `proposer_id is null` guard above is what keeps this from repeating.
  if (claimed.length > 0) {
    await db
      .insert(notifications)
      .values(projectsClaimedNotification(userId, claimed.length));
  }
  return claimed.length;
}
