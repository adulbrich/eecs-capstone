import { eq } from "drizzle-orm";
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
import { canEditProject, canWritePrivateNotes } from "#/lib/project-visibility";
import {
  type ActorRole,
  assertTransitionAllowed,
  type Status,
} from "#/lib/project-workflow";
import { isStaff, type Viewer } from "#/lib/viewer";
import type { ProjectInput, UpdateProjectInput } from "../projects";
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

function viewerToVisibility(viewer: AuthUser): Viewer {
  return { id: viewer.id, role: viewer.role ?? null };
}

async function loadProjectOr404(id: string) {
  const [row] = await db.select().from(projects).where(eq(projects.id, id));
  if (!row) {
    throw new Error("Project not found");
  }
  return row;
}

async function resolveProposerId(
  email: string | null | undefined
): Promise<string | null> {
  if (!email) {
    return null;
  }
  const [match] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email));
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
  const staff = isStaff(viewerToVisibility(viewer));
  const proposerEmail = staff ? data.proposerEmail || null : null;
  // On create a blank proposer email defaults the proposer to the creator, so a
  // new project always has an owner. Staff link a different proposer by entering
  // their email. On edit, clearing the field is instead an explicit unlink.
  const proposerId = proposerEmail
    ? await resolveProposerId(proposerEmail)
    : viewer.id;
  // Private notes belong to staff and the proposer jointly. On create the
  // writer is always one of the two by construction (only staff may name a
  // different proposer; everyone else becomes the proposer), so there is
  // nothing to gate here. The update path re-checks per project.
  const allowedNotes = data.notes ?? null;

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
      imageUrl: (data.imageUrl || null) as string | null,
      ...ndaFields(data),
      isSponsored: data.isSponsored ?? false,
      programId: data.programId ?? null,
      notes: allowedNotes,
      proposerId,
      proposerEmail,
      status: "draft",
      teamsSupported: data.teamsSupported ?? 1,
    })
    .returning();
  return { id: created.id };
}

/**
 * What this edit writes, given who is making it.
 *
 * Server-side rather than in `src/lib/` beside the diff: the staff branch
 * resolves a proposer address to an account id, which is a database read. It
 * exists to keep `updateProjectAs` to four steps, not to be tested alone; the
 * integration suite already covers both branches.
 */
async function buildProjectValues(
  data: UpdateProjectInput,
  existing: Awaited<ReturnType<typeof loadProjectOr404>>,
  visibility: Viewer
): Promise<Partial<typeof projects.$inferSelect>> {
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
  };
  if (canWritePrivateNotes(existing, visibility)) {
    newValues.notes = data.notes ?? null;
  }
  // Omitted and cleared are different asks, and only staff may make either.
  // An empty string is the explicit unlink the edit form sends when a staff
  // member clears the field. `undefined` is "this save is not about the
  // proposer", which is what the new-project route means when it saves an
  // uploaded image key. Treating the two alike is what made omission silently
  // destructive, and it cost a spurious "proposer changed" row in the edit log
  // the one time a caller had to round-trip the address to avoid it.
  //
  // Only this field is three-state, and that is deliberate: every other key in
  // `newValues` is `data.x ?? null`, so a caller that omits one clears it.
  // Making them all three-state would cost the property the type comment above
  // depends on, that this object is the one statement of which columns an edit
  // touches. This is not a general partial-update facility.
  if (isStaff(visibility) && data.proposerEmail !== undefined) {
    const proposerEmail = data.proposerEmail || null;
    newValues.proposerEmail = proposerEmail;
    newValues.proposerId = proposerEmail
      ? await resolveProposerId(proposerEmail)
      : null;
  }
  return newValues;
}

export async function updateProjectAs(
  viewer: AuthUser,
  data: UpdateProjectInput,
  embed?: EmbedFn
): Promise<{ id: string; updated: boolean }> {
  const visibility = viewerToVisibility(viewer);
  const existing = await loadProjectOr404(data.id);
  if (!canEditProject(existing, visibility)) {
    throw new Error("Forbidden");
  }
  const newValues = await buildProjectValues(data, existing, visibility);

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

  // After the commit, never inside it: a rollback would otherwise destroy the
  // object the surviving row still points at. This is the only place a key is
  // replaced; create only ever writes a first one, and
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

function assertChangesRequestedHasComment(
  target: Status,
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
  target: Status,
  comment: string | null,
  opts?: TransitionOptions
): Promise<{ id: string; status: Status }> {
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
  target: Status,
  comment?: string,
  opts?: TransitionOptions
): Promise<{ id: string; status: Status }> {
  const visibility = viewerToVisibility(viewer);
  const project = await loadProjectOr404(id);
  if (!isStaff(visibility) && project.proposerId !== viewer.id) {
    throw new Error("Forbidden");
  }
  const role: ActorRole = isStaff(visibility) ? "staff" : "owner";
  assertTransitionAllowed(project.status as Status, target, role);
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
  const visibility = viewerToVisibility(viewer);
  if (!isStaff(visibility)) {
    throw new Error("Forbidden");
  }
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
  const visibility = viewerToVisibility(viewer);
  if (!isStaff(visibility)) {
    throw new Error("Forbidden");
  }
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
  const visibility = viewerToVisibility(viewer);
  const project = await loadProjectOr404(id);
  if (project.status !== "draft") {
    throw new Error("Hard delete only allowed on drafts.");
  }
  const isOwner = project.proposerId === viewer.id;
  if (!(isOwner || isStaff(visibility))) {
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
  target: Status,
  comment?: string,
  opts?: TransitionOptions
): Promise<{ id: string; status: Status }> {
  const visibility = viewerToVisibility(viewer);
  if (!isStaff(visibility)) {
    throw new Error("Forbidden");
  }
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
  target: Status,
  comment?: string,
  sendEmail?: boolean
) {
  const viewer = await requireUser();
  return performTransitionAs(viewer, id, target, comment, { sendEmail });
}

export async function forceTransitionForCurrentUser(
  id: string,
  target: Status,
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
