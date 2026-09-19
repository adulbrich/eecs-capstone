import { and, eq, notExists, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "#/db";
import { projectComments, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { isStaff } from "#/lib/viewer";
import type { AddCommentInput, UpdateCommentInput } from "../comments";
import type { EmailOptions } from "./email-dispatch";
import { recordCommentNotifications } from "./notify";
import { notifyCommentByEmail } from "./project-emails";

export interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

/**
 * Who is in a project's comment thread.
 *
 * Comments are a private submitter to staff dialogue, so only the project's
 * current proposer and staff may take part. Called rather than wrapped, so
 * each writer still spells its own guard at its own call site, which is what
 * [ADR-0003](../../../docs/adr/0003-every-server-function-declares-its-access-level.md)
 * asks for: there is no middleware, and a guard that vanishes into a shared
 * caller is a guard no grep finds. Shared because the rule is one rule, and
 * the next change to who is in a thread should not have to be remembered
 * twice (#503).
 *
 * Note "current": the proposer of the moment, not whoever proposed it once.
 * Staff reassign a project, and the previous proposer leaves the conversation
 * even though their comments stay in it.
 */
function assertThreadMember(
  viewer: AuthUser,
  project: { proposerId: string | null }
): void {
  if (!(isStaff(viewer) || project.proposerId === viewer.id)) {
    throw new Error("Forbidden");
  }
}

export async function addCommentAs(
  viewer: AuthUser,
  data: AddCommentInput,
  opts?: EmailOptions
): Promise<{ id: string }> {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, data.projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  assertThreadMember(viewer, project);
  // Checked against the caller's own flag, before any inheritance below, so a
  // non-staff caller cannot smuggle an internal comment in via a parentId.
  if (data.isInternal && !isStaff(viewer)) {
    throw new Error("Only staff may post internal comments");
  }
  let isInternal = data.isInternal;
  if (data.parentId) {
    const [parent] = await db
      .select()
      .from(projectComments)
      .where(
        and(
          eq(projectComments.id, data.parentId),
          eq(projectComments.projectId, data.projectId)
        )
      );
    if (!parent) {
      throw new Error("Parent comment not found on this project");
    }
    if (parent.parentId) {
      throw new Error("Replies are one level deep");
    }
    // An internal thread stays internal all the way down: a reply that quoted
    // its internal parent would otherwise expose that parent's substance to
    // the proposer. The converse is deliberately not true, so staff can still
    // start an internal side-thread under a comment the proposer can see.
    if (parent.isInternal) {
      isInternal = true;
    }
  }

  const row = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(projectComments)
      .values({
        projectId: data.projectId,
        authorId: viewer.id,
        parentId: data.parentId ?? null,
        content: data.content,
        isInternal,
      })
      .returning();
    await recordCommentNotifications(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      {
        id: inserted.id,
        authorId: inserted.authorId,
        parentId: inserted.parentId,
        isInternal: inserted.isInternal,
        content: inserted.content,
      }
    );
    return inserted;
  });
  // After the transaction, never inside it: a failed email must not undo a
  // comment. notifyCommentByEmail swallows its own errors. The skip is
  // staff's, decided from the role as in `performTransitionAs`: a proposer's
  // comment mails the staff inbox whatever they send (#379).
  if (isStaff(viewer) ? (opts?.sendEmail ?? true) : true) {
    await notifyCommentByEmail(
      {
        authorIsStaff: isStaff(viewer),
        comment: {
          authorId: row.authorId,
          content: row.content,
          id: row.id,
          isInternal: row.isInternal,
        },
        project: {
          id: project.id,
          proposerEmail: project.proposerEmail,
          proposerId: project.proposerId,
          title: project.title,
        },
      },
      opts?.send
    );
  }
  return { id: row.id };
}

export async function addCommentForCurrentUser(
  data: AddCommentInput & { sendEmail: boolean }
) {
  const viewer = await requireUser();
  const { sendEmail, ...fields } = data;
  return addCommentAs(viewer, fields, { sendEmail });
}

/**
 * The refusal a locked comment gives, in one place because two callers show it
 * to a reader: the thread renders it under the editor, and the server throws it
 * at anyone who posts past a hidden Edit button.
 *
 * Deliberately generic. A proposer can be locked by a staff reply they are not
 * allowed to see, so a message naming the reply would say more than
 * `filterCommentsForViewer` lets through (#503).
 */
export const COMMENT_LOCKED_MESSAGE = "This comment can no longer be edited";

/**
 * Content only, by the author only, until the first reply.
 *
 * Nothing here notifies: `addCommentAs` mails the text and stores a 200
 * character snapshot on a `notifications` row, and an edit leaves both as
 * posted. The recipient already holds the original in their inbox, so a bell
 * entry matching what they were told is consistent rather than stale, and
 * rewriting it would quietly change a record whose link already anchors here
 * (#503).
 */
export async function updateCommentAs(
  viewer: AuthUser,
  data: UpdateCommentInput
): Promise<{ id: string }> {
  const [row] = await db
    .select({ authorId: projectComments.authorId, project: projects })
    .from(projectComments)
    .innerJoin(projects, eq(projects.id, projectComments.projectId))
    .where(eq(projectComments.id, data.commentId));
  if (!row) {
    throw new Error("Comment not found");
  }
  // Two gates, and both are needed. Membership is the same rule a post goes
  // through. Authorship narrows it to the one person who wrote these words,
  // because the thread is what a review decision was made on and nobody
  // rewrites anybody else's part of it, staff included. Membership alone would
  // let staff rewrite a proposer; authorship alone would let a replaced
  // proposer keep editing a conversation they have left.
  assertThreadMember(viewer, row.project);
  if (row.authorId !== viewer.id) {
    throw new Error("Forbidden");
  }

  // The reply lock rides on the write rather than a read before it. Any reply,
  // by anyone, internal or not: a reply's meaning depends on the text it
  // answers. Asking first and writing second leaves a window in which a reply
  // lands between the two, and the edit it should have stopped goes through.
  const child = alias(projectComments, "child");
  const updated = await db
    .update(projectComments)
    .set({ content: data.content, editedAt: new Date() })
    .where(
      and(
        eq(projectComments.id, data.commentId),
        notExists(
          db
            .select({ one: sql`1` })
            .from(child)
            .where(eq(child.parentId, data.commentId))
        )
      )
    )
    .returning({ id: projectComments.id });
  if (updated.length === 0) {
    throw new Error(COMMENT_LOCKED_MESSAGE);
  }
  return { id: data.commentId };
}

export async function updateCommentForCurrentUser(data: UpdateCommentInput) {
  const viewer = await requireUser();
  return updateCommentAs(viewer, data);
}
