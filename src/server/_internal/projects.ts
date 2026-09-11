import { eq, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  projectEditLog,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { EmbedFn } from "#/lib/_internal/bedrock-embed";
import { diffRowFields } from "#/lib/edit-diff";
import { normalizeEmailAddress } from "#/lib/email-address";
import { assertNoImageKeyOnCreate } from "#/lib/image-upload-policy";
import { canEditProject, canWritePrivateNotes } from "#/lib/project-visibility";
import {
  type ActorRole,
  assertTransitionAllowed,
} from "#/lib/project-workflow";
import { assertStaff, isStaff, type Viewer } from "#/lib/viewer";
import type { ProjectStatus } from "#/lib/vocabularies";
import type {
  MentorshipInput,
  ProjectInput,
  ProposerInput,
  UpdateProjectInput,
} from "../projects";
import {
  recordSoftDeleteNotification,
  recordStatusChangeNotifications,
} from "./notify";
import { notifyTransitionByEmail, type SendEmailFn } from "./project-emails";
import { refreshProjectEmbedding } from "./project-embeddings";

export interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

export interface TransitionOptions {
  embed?: EmbedFn;
  /** Test seam. Production callers omit it and the notifier resolves its own transport. */
  send?: SendEmailFn;
  sendEmail?: boolean;
}

async function loadProjectOr404(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) {
    throw new Error("Project not found");
  }
  return row;
}

/**
 * The account behind a proposer address, or null when there is none.
 *
 * This matched case-sensitively until #249, so staff entering
 * `Sam@oregonstate.edu` for an account stored as `sam@oregonstate.edu`
 * linked nobody and the project was written with a null `proposer_id` and no
 * error. Normalizing the input is what fixes it.
 *
 * The `lower()` on the column is belt and braces on top. Better Auth
 * lowercases `user.email` on every path that creates an account here, so
 * both sides are already lowercase in practice; that is its internals rather
 * than a published contract, and an upgrade changing it would otherwise
 * unlink proposers silently. It costs the index on `user.email`, which is
 * the same trade `claimProjectsForVerifiedUser` documents and takes.
 *
 * Fixing this does not reach the projects the bug already orphaned. Their
 * `proposer_id` is null and no write path revisits them, because
 * `claimProjectsForVerifiedUser` fires once per account at verification and
 * an already-verified account never verifies again (#277).
 */
async function resolveProposerId(
  email: string | null | undefined
): Promise<string | null> {
  const address = normalizeEmailAddress(email);
  if (!address) {
    return null;
  }
  const [match] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(sql`lower(${user.email})`, address));
  return match?.id ?? null;
}

/**
 * The NDA/IP pair, kept consistent in one place because create and update
 * both write it. `requiresNdaIp` is the source of truth: the form hides the
 * restrictions textarea behind the checkbox, so text surviving an unchecked
 * box would be prose nothing renders, and would break the rule that an empty
 * restrictions field means no agreement is required.
 */
function ndaFields(data: {
  licenseRestrictions?: string | null;
  requiresNdaIp?: boolean;
}): { licenseRestrictions: string | null; requiresNdaIp: boolean } {
  const requiresNdaIp = data.requiresNdaIp ?? false;
  return {
    licenseRestrictions: requiresNdaIp
      ? (data.licenseRestrictions ?? null)
      : null,
    requiresNdaIp,
  };
}

export async function createProjectAs(
  viewer: AuthUser,
  data: ProjectInput
): Promise<{ id: string }> {
  // The creator is the proposer, staff included (#322): a new project always
  // has an owner, and `ProjectInput` has no room for a different one. Staff
  // reassign from the project page through `updateProjectProposerAs`.
  const proposerId = viewer.id;
  // Private notes belong to staff and the proposer jointly. On create the
  // writer is the proposer by construction, so there is nothing to gate here.
  // The update path re-checks per project.
  const allowedNotes = data.notes ?? null;

  assertNoImageKeyOnCreate(data.imageUrl);

  const [created] = await db
    .insert(projects)
    .values({
      title: data.title,
      description: data.description ?? null,
      problemStatement: data.problemStatement ?? null,
      objectives: data.objectives ?? null,
      minQualifications: data.minQualifications ?? null,
      prefQualifications: data.prefQualifications ?? null,
      url: (data.url || null) as string | null,
      contactEmail: (data.contactEmail || null) as string | null,
      contactName: data.contactName ?? null,
      // Always null: `assertNoImageKeyOnCreate` above refuses anything else,
      // and the first key arrives through a second write.
      imageUrl: null,
      ...ndaFields(data),
      isSponsored: data.isSponsored ?? false,
      programId: data.programId ?? null,
      notes: allowedNotes,
      proposerId,
      proposerEmail: null,
      status: "draft",
      teamsSupported: data.teamsSupported ?? 1,
      acceptingApplicants: data.acceptingApplicants ?? true,
    })
    .returning();
  return { id: created.id };
}

/**
 * What this edit writes, given who is making it.
 *
 * Every key is `data.x ?? null`, so a caller that omits one clears it: this
 * object is the one statement of which columns an edit touches, and it is not
 * a partial-update facility. The proposer used to be the one three-state
 * exception here; since #322 it has its own writer, `updateProjectProposerAs`,
 * and `UpdateProjectInput` has no key for it, so this cannot reach it.
 */
function buildProjectValues(
  data: UpdateProjectInput,
  existing: Awaited<ReturnType<typeof loadProjectOr404>>,
  viewer: Viewer
): Partial<typeof projects.$inferSelect> {
  // Typed against the table rather than as a loose record, because this object
  // is the only statement of which columns an edit may touch. `diffRowFields`
  // reads its keys, and `.set()` writes them, so a key that is not a column has
  // to be a typecheck failure here rather than a surprise at either end.
  const newValues: Partial<typeof projects.$inferSelect> = {
    title: data.title,
    description: data.description ?? null,
    problemStatement: data.problemStatement ?? null,
    objectives: data.objectives ?? null,
    minQualifications: data.minQualifications ?? null,
    prefQualifications: data.prefQualifications ?? null,
    url: data.url || null,
    contactEmail: data.contactEmail || null,
    contactName: data.contactName ?? null,
    imageUrl: data.imageUrl || null,
    ...ndaFields(data),
    isSponsored: data.isSponsored ?? false,
    programId: data.programId ?? null,
    teamsSupported: data.teamsSupported ?? 1,
    acceptingApplicants: data.acceptingApplicants ?? true,
  };
  if (canWritePrivateNotes(existing, viewer)) {
    newValues.notes = data.notes ?? null;
  }
  return newValues;
}

export async function updateProjectAs(
  viewer: AuthUser,
  data: UpdateProjectInput,
  embed?: EmbedFn
): Promise<{ id: string; updated: boolean }> {
  const existing = await loadProjectOr404(data.id);
  if (!canEditProject(existing, viewer)) {
    throw new Error("Forbidden");
  }
  const newValues = buildProjectValues(data, existing, viewer);

  const { changedFields, newDiff, oldDiff } = diffRowFields(
    existing,
    newValues
  );

  if (changedFields.length === 0) {
    return { id: existing.id, updated: false };
  }

  // Only when the value CHANGES, which is the whole reason a row still holding
  // a legacy absolute URL stays editable: saving it back unchanged is not a
  // change, so nothing checks it. See #162.
  if (changedFields.includes("imageUrl")) {
    const { assertOwnedKey, projectImageKeys } = await import(
      "#/lib/_internal/storage"
    );
    assertOwnedKey(newValues.imageUrl, projectImageKeys(existing.id));
  }

  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ ...newValues, updatedAt: new Date() })
      .where(eq(projects.id, existing.id));
    await tx.insert(projectEditLog).values({
      projectId: existing.id,
      editorId: viewer.id,
      changedFields,
      oldValues: oldDiff,
      newValues: newDiff,
    });
  });

  // After the commit, never inside it: a rollback would otherwise destroy the
  // object the surviving row still points at. This is the only place a key is
  // written at all; create refuses one and writes null, and
  // `hardDeleteProjectAs` drops the last one.
  if (changedFields.includes("imageUrl")) {
    const { deleteOwnedObject, projectImageKeys } = await import(
      "#/lib/_internal/storage"
    );
    await deleteOwnedObject(existing.imageUrl, projectImageKeys(existing.id));
  }

  if (existing.status === "published") {
    await refreshProjectEmbedding(existing.id, embed);
  }

  return { id: existing.id, updated: true };
}

/**
 * The only writer of `proposerEmail` and `proposerId` after create (#322).
 *
 * Staff-only, and deliberately not part of `updateProjectAs`: the key is not
 * on `ProjectInput`, so the shared form cannot carry it and a proposer has no
 * endpoint that reassigns their own project. An address links or reassigns;
 * an empty string or null unlinks, leaving an external proposer with no
 * account and no address. `proposerId` is derived from the address here and
 * never taken from the client (ADR-0007). One edit-log row per change, and a
 * save that changes nothing writes none, the same as mentorship.
 */
export async function updateProjectProposerAs(
  viewer: Viewer,
  data: ProposerInput
): Promise<{ id: string; updated: boolean }> {
  assertStaff(viewer);
  const existing = await loadProjectOr404(data.id);
  const proposerEmail = normalizeEmailAddress(data.proposerEmail);
  const newValues: Partial<typeof projects.$inferSelect> = {
    proposerEmail,
    proposerId: proposerEmail ? await resolveProposerId(proposerEmail) : null,
  };
  const { changedFields, newDiff, oldDiff } = diffRowFields(
    existing,
    newValues
  );
  if (changedFields.length === 0) {
    return { id: existing.id, updated: false };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ ...newValues, updatedAt: new Date() })
      .where(eq(projects.id, existing.id));
    await tx.insert(projectEditLog).values({
      projectId: existing.id,
      editorId: viewer.id,
      changedFields,
      oldValues: oldDiff,
      newValues: newDiff,
    });
  });
  return { id: existing.id, updated: true };
}

export async function updateProjectProposerForCurrentUser(data: ProposerInput) {
  const viewer = await requireUser();
  return updateProjectProposerAs(viewer, data);
}

/**
 * The only writer of `studentProposed`, `seekingMentor` and `mentorEmail`.
 *
 * Staff-only, and deliberately not part of `updateProjectAs`: none of the
 * keys exists on `ProjectInput`, so the shared form cannot carry them and a
 * proposer has no endpoint that accepts them. That is what makes "staff edit
 * these" structural rather than a check someone remembers to keep.
 *
 * The address is trimmed and lowercased, like every address column this app
 * writes (#249), and this function is where that costs something: the edit
 * log below records the normalized address rather than what staff typed, and
 * an edit changing only case finds no changed field and returns
 * `updated: false`. Both follow from normalizing on write and were accepted
 * with it. Matching stays case-insensitive at read time regardless, because
 * `mentorNameSql` compares against `user.email`, which is Better Auth's
 * column rather than one of the four this app normalizes.
 *
 * No embedding refresh: none of the columns is part of the embedding source
 * text.
 */
export async function updateProjectMentorshipAs(
  viewer: Viewer,
  data: MentorshipInput
): Promise<{ id: string; updated: boolean }> {
  assertStaff(viewer);
  const existing = await loadProjectOr404(data.id);
  const newValues: Partial<typeof projects.$inferSelect> = {
    studentProposed: data.studentProposed,
    seekingMentor: data.seekingMentor,
    mentorEmail: normalizeEmailAddress(data.mentorEmail),
  };
  const { changedFields, newDiff, oldDiff } = diffRowFields(
    existing,
    newValues
  );
  if (changedFields.length === 0) {
    return { id: existing.id, updated: false };
  }
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ ...newValues, updatedAt: new Date() })
      .where(eq(projects.id, existing.id));
    await tx.insert(projectEditLog).values({
      projectId: existing.id,
      editorId: viewer.id,
      changedFields,
      oldValues: oldDiff,
      newValues: newDiff,
    });
  });
  return { id: existing.id, updated: true };
}

export async function updateProjectMentorshipForCurrentUser(
  data: MentorshipInput
) {
  const viewer = await requireUser();
  return updateProjectMentorshipAs(viewer, data);
}

function assertChangesRequestedHasComment(
  target: ProjectStatus,
  comment: string | null
): void {
  if (target === "changes_requested" && !comment?.trim()) {
    throw new Error(
      "A comment describing the requested changes is required so the proposer knows what to change."
    );
  }
}

/**
 * Everything a status transition does once someone is allowed to make it.
 *
 * The two public transitions differ only in who may act and which targets are
 * reachable. Both gates sit above this and neither is repeated here.
 *
 * The ordering below is why this is a function rather than a comment:
 * notifications belong to the transaction, and the two remote calls must not
 * be in it.
 *
 * Takes `actorId` rather than a viewer on purpose. Authorization is settled
 * before this runs, so there is no role left for it to consult.
 */
async function commitTransition(
  actorId: string,
  project: typeof projects.$inferSelect,
  target: ProjectStatus,
  comment: string | null,
  opts?: TransitionOptions
): Promise<{ id: string; status: ProjectStatus }> {
  assertChangesRequestedHasComment(target, comment);

  await db.transaction(async (tx) => {
    const updates: Record<string, unknown> = {
      status: target,
      updatedAt: new Date(),
    };
    if (target === "published" && !project.publishedAt) {
      updates.publishedAt = new Date();
    }
    if (target === "archived") {
      updates.archivedAt = new Date();
    }
    await tx.update(projects).set(updates).where(eq(projects.id, project.id));

    await tx.insert(projectStatusHistory).values({
      projectId: project.id,
      oldStatus: project.status,
      newStatus: target,
      changedBy: actorId,
      comment,
    });

    await recordStatusChangeNotifications(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      target,
      actorId,
      comment
    );
  });

  // After the transaction, never inside it: a Bedrock call must not hold a
  // database transaction open, and its failure must not roll back the publish.
  //
  // Inside the transaction this would not even fail loudly.
  // refreshProjectEmbedding re-reads the row and returns "skipped" unless the
  // status is already published, so getting the order wrong gives you a
  // project that publishes and never embeds.
  if (target === "published") {
    await refreshProjectEmbedding(project.id, opts?.embed);
  }

  // Same reasoning, and it matters more here: a failed email must not undo an
  // approval. notifyTransitionByEmail swallows its own errors.
  await notifyTransitionByEmail(
    {
      description: project.description,
      id: project.id,
      proposerEmail: project.proposerEmail,
      proposerId: project.proposerId,
      title: project.title,
    },
    target,
    comment,
    opts?.sendEmail ?? true,
    opts?.send
  );

  return { id: project.id, status: target };
}

export async function performTransitionAs(
  viewer: AuthUser,
  id: string,
  target: ProjectStatus,
  comment?: string,
  opts?: TransitionOptions
): Promise<{ id: string; status: ProjectStatus }> {
  const project = await loadProjectOr404(id);
  if (!isStaff(viewer) && project.proposerId !== viewer.id) {
    throw new Error("Forbidden");
  }
  const role: ActorRole = isStaff(viewer) ? "staff" : "owner";
  assertTransitionAllowed(project.status as ProjectStatus, target, role);
  // Skipping the mail is a staff affordance, so the decision is made here from
  // the role rather than read off the request. `sendEmail` cannot be gated by
  // the schema instead: three owner-reachable endpoints carry it, and one of
  // them is `performTransition`, which takes its target status from the wire
  // and so serves staff and owners through the same validator. Without this a
  // proposer could submit and suppress the notice to EMAIL_REVIEW_INBOX, which
  // is the only push telling staff a project arrived.
  //
  // Ignored rather than rejected: an unexpected `false` is a client bug or a
  // probe, and neither should fail a student's submission.
  return commitTransition(viewer.id, project, target, comment ?? null, {
    ...opts,
    sendEmail: role === "staff" ? (opts?.sendEmail ?? true) : true,
  });
}

export async function softDeleteProjectAs(
  viewer: AuthUser,
  id: string
): Promise<{ id: string }> {
  assertStaff(viewer);
  const project = await loadProjectOr404(id);
  if (project.status === "draft") {
    throw new Error("Cannot soft-delete a draft; hard-delete instead.");
  }
  if (project.deletedAt) {
    throw new Error("Already soft-deleted.");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(eq(projects.id, id));
    await recordSoftDeleteNotification(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      "soft-deleted",
      viewer.id
    );
  });
  return { id };
}

export async function restoreProjectAs(
  viewer: AuthUser,
  id: string
): Promise<{ id: string }> {
  assertStaff(viewer);
  const project = await loadProjectOr404(id);
  if (!project.deletedAt) {
    throw new Error("Not soft-deleted.");
  }
  await db.transaction(async (tx) => {
    await tx
      .update(projects)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(projects.id, id));
    await recordSoftDeleteNotification(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      "restored",
      viewer.id
    );
  });
  return { id };
}

export async function hardDeleteProjectAs(
  viewer: AuthUser,
  id: string
): Promise<{ id: string }> {
  const project = await loadProjectOr404(id);
  if (project.status !== "draft") {
    throw new Error("Hard delete only allowed on drafts.");
  }
  const isOwner = project.proposerId === viewer.id;
  if (!(isOwner || isStaff(viewer))) {
    throw new Error("Forbidden");
  }
  await db.delete(projects).where(eq(projects.id, id));
  // The row is gone, so nothing will ever reference the object again. Soft
  // delete is deliberately not here: it keeps the row, so it keeps the image,
  // exactly as a retired inventory item does. See #159.
  if (project.imageUrl) {
    const { deleteOwnedObject, projectImageKeys } = await import(
      "#/lib/_internal/storage"
    );
    await deleteOwnedObject(project.imageUrl, projectImageKeys(id));
  }
  return { id };
}

export async function forceTransitionAs(
  viewer: AuthUser,
  id: string,
  target: ProjectStatus,
  comment?: string,
  opts?: TransitionOptions
): Promise<{ id: string; status: ProjectStatus }> {
  assertStaff(viewer);
  const project = await loadProjectOr404(id);
  if (project.status === target) {
    throw new Error("Project is already in that status.");
  }
  return commitTransition(viewer.id, project, target, comment ?? null, opts);
}

// Convenience wrappers that resolve the current user from the request
// and delegate to the *As helpers. These are what the createServerFn
// handlers in src/server/projects.ts call.

export async function createProjectForCurrentUser(data: ProjectInput) {
  const viewer = await requireUser();
  return createProjectAs(viewer, data);
}

export async function updateProjectForCurrentUser(data: UpdateProjectInput) {
  const viewer = await requireUser();
  return updateProjectAs(viewer, data);
}

export async function performTransitionForCurrentUser(
  id: string,
  target: ProjectStatus,
  comment?: string,
  sendEmail?: boolean
) {
  const viewer = await requireUser();
  return performTransitionAs(viewer, id, target, comment, { sendEmail });
}

export async function forceTransitionForCurrentUser(
  id: string,
  target: ProjectStatus,
  comment?: string,
  sendEmail?: boolean
) {
  const viewer = await requireUser();
  return forceTransitionAs(viewer, id, target, comment, { sendEmail });
}

export async function softDeleteProjectForCurrentUser(id: string) {
  const viewer = await requireUser();
  return softDeleteProjectAs(viewer, id);
}

export async function restoreProjectForCurrentUser(id: string) {
  const viewer = await requireUser();
  return restoreProjectAs(viewer, id);
}

export async function hardDeleteProjectForCurrentUser(id: string) {
  const viewer = await requireUser();
  return hardDeleteProjectAs(viewer, id);
}
