import { and, eq, getTableName, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { db } from "#/db";
import {
  account,
  aiReviewUsage,
  inventoryCartItems,
  inventoryItems,
  inventoryRequestItems,
  inventoryRequests,
  notifications,
  programInstructors,
  programs,
  projectBookmarks,
  projectCollaborators,
  projects,
  session,
  user,
  userInterests,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { Viewer } from "#/lib/viewer";
import type { DeleteAccountInput } from "../account";
import { heldByViewer } from "./inventory-holdings";

export interface DeletionPreview {
  blockers: {
    /** Items the person still holds or is due to collect. Deletion waits. */
    items: { id: string; name: string }[];
    /** The only admin cannot leave the app with none. */
    lastAdmin: boolean;
  };
  email: string;
  /** Instructor memberships that deletion will remove. Not a blocker. */
  programs: { courseId: string; courseName: string; id: string }[];
}

/**
 * Every table whose foreign key into `user.id` says `onDelete: "cascade"`.
 *
 * The `user` row is never deleted, because nine `restrict` edges (comments,
 * status history, bids, assignments, edit logs) are audit records the row
 * exists to anchor. So what a real DELETE would have cascaded is deleted
 * here by hand, and only that: a cascade edge is the schema's own statement
 * that the rows are the person's and not the record's. Everything on a
 * `restrict` or `set null` edge keeps pointing at the anonymized row.
 *
 * `account.integration.test.ts` reads the schema files and pins this list
 * to the edges it finds, so a new cascade edge without a delete here is a
 * red test rather than a row that outlives the account.
 */
const CASCADE_EDGES: (PgTable & { userId: AnyPgColumn })[] = [
  session,
  account,
  userInterests,
  programInstructors,
  projectCollaborators,
  projectBookmarks,
  inventoryCartItems,
  notifications,
  aiReviewUsage,
];

export const CASCADE_TABLES: readonly string[] = CASCADE_EDGES.map((t) =>
  getTableName(t)
);

/**
 * What deleting this account would do, for the dialog to say out loud and
 * for `deleteAccountAs` to refuse on. Reads the row rather than trusting the
 * session for role and address: both can be stale by a request.
 */
export async function getAccountDeletionPreviewAs(
  viewer: NonNullable<Viewer>
): Promise<DeletionPreview> {
  const [row] = await db
    .select({
      email: user.email,
      emailVerified: user.emailVerified,
      role: user.role,
    })
    .from(user)
    .where(eq(user.id, viewer.id));
  if (!row) {
    throw new Error("Account not found");
  }
  const [held, awaiting, admins, taught] = await Promise.all([
    // The same predicate /my/items reads, so the block and the page cannot
    // disagree about what the person is holding.
    db
      .select({ id: inventoryItems.id, name: inventoryItems.name })
      .from(inventoryItems)
      .where(heldByViewer(viewer.id, row.emailVerified ? row.email : null)),
    db
      .select({ id: inventoryItems.id, name: inventoryItems.name })
      .from(inventoryRequestItems)
      .innerJoin(
        inventoryRequests,
        eq(inventoryRequestItems.requestId, inventoryRequests.id)
      )
      .innerJoin(
        inventoryItems,
        eq(inventoryRequestItems.itemId, inventoryItems.id)
      )
      .where(
        and(
          eq(inventoryRequests.userId, viewer.id),
          eq(inventoryRequestItems.status, "approved")
        )
      ),
    row.role === "admin"
      ? db
          .select({ n: sql<number>`count(*)::int` })
          .from(user)
          .where(eq(user.role, "admin"))
      : Promise.resolve([{ n: 0 }]),
    db
      .select({
        courseId: programs.courseId,
        courseName: programs.courseName,
        id: programs.id,
      })
      .from(programInstructors)
      .innerJoin(programs, eq(programInstructors.programId, programs.id))
      .where(eq(programInstructors.userId, viewer.id))
      .orderBy(programs.courseId),
  ]);
  const items = new Map<string, { id: string; name: string }>();
  for (const item of [...held, ...awaiting]) {
    items.set(item.id, item);
  }
  return {
    blockers: {
      items: [...items.values()],
      lastAdmin: row.role === "admin" && admins[0].n === 1,
    },
    email: row.email,
    programs: taught,
  };
}

export async function getAccountDeletionPreviewForCurrentUser() {
  const current = await requireUser();
  return getAccountDeletionPreviewAs(current);
}

/**
 * Anonymizes the account in place. Irreversible and immediate: no grace
 * window, because a grace window stores data the person was told is gone.
 *
 * `projects.proposer_id` deliberately stays. It attributes the project to
 * "Deleted user" for free, and it is what makes the no-reclaim rule
 * structural: `claimProjectsForVerifiedUser` claims only rows whose
 * proposer is null, so an address registered again gets nothing back.
 * `proposer_email` is account information and goes; `contact_*` is project
 * content the person typed to publish and stays. `mentor_email` goes
 * wherever it matches, since the mentor link resolves by address at read
 * time and would otherwise keep a real address the policy promised away.
 *
 * The avatar object is deleted after the commit and never inside it, and
 * `deleteOwnedObject` swallows the failure by design: an orphaned object is
 * a sweep problem, a half-deleted account is a broken promise.
 */
export async function deleteAccountAs(
  viewer: NonNullable<Viewer>,
  data: DeleteAccountInput
): Promise<{ ok: true }> {
  const preview = await getAccountDeletionPreviewAs(viewer);
  if (data.confirmEmail.trim().toLowerCase() !== preview.email.toLowerCase()) {
    throw new Error("Email does not match");
  }
  if (preview.blockers.items.length > 0) {
    throw new Error("Account has outstanding items");
  }
  if (preview.blockers.lastAdmin) {
    throw new Error("The last admin cannot delete their account");
  }
  const [row] = await db
    .select({ image: user.image })
    .from(user)
    .where(eq(user.id, viewer.id));
  const address = preview.email.toLowerCase();

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        name: "Deleted user",
        // RFC 2606 reserves .invalid, so this is unique, undeliverable and
        // never anyone's real address.
        email: `deleted-${viewer.id}@invalid`,
        emailVerified: false,
        image: null,
        role: "user",
        banned: false,
        banReason: null,
        banExpires: null,
        affiliation: null,
        linkedin: null,
        wantsToMentor: false,
        mentorTeamCount: 1,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(user.id, viewer.id));
    for (const table of CASCADE_EDGES) {
      await tx.delete(table).where(eq(table.userId, viewer.id));
    }
    await tx
      .update(projects)
      .set({ proposerEmail: null })
      .where(eq(projects.proposerId, viewer.id));
    await tx
      .update(projects)
      .set({ mentorEmail: null })
      .where(sql`lower(${projects.mentorEmail}) = ${address}`);
  });

  const { avatarKeys, deleteOwnedObject } = await import(
    "#/lib/_internal/storage"
  );
  await deleteOwnedObject(row?.image, avatarKeys(viewer.id));
  return { ok: true };
}

export async function deleteAccountForCurrentUser(data: DeleteAccountInput) {
  const current = await requireUser();
  return deleteAccountAs(current, data);
}
