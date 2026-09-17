import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "#/db";
import {
  programs,
  projectEditLog,
  projectPrograms,
  projectStatusHistory,
  projects,
  user,
} from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import type { EmbedFn } from "#/lib/_internal/bedrock-embed";
import { diffRowFields } from "#/lib/edit-diff";
import { normalizeEmailAddress } from "#/lib/email-address";
import { assertNoImageKeyOnCreate } from "#/lib/image-upload-policy";
import {
  canEditProject,
  canWritePrivateNotes,
  programLabel,
} from "#/lib/project-visibility";
import {
  type ActorRole,
  assertTransitionAllowed,
} from "#/lib/project-workflow";
import { assertStaff, isStaff, type Viewer } from "#/lib/viewer";
import type { ProjectStatus } from "#/lib/vocabularies";
import type {
  MentorshipInput,
  ProgramsInput,
  ProjectInput,
  ProposerInput,
  UpdateProjectInput,
} from "../projects";
import type { EmailOptions } from "./email-dispatch";
import {
  recordProposerReassignedNotification,
  recordSoftDeleteNotification,
  recordStatusChangeNotifications,
} from "./notify";
import {
  notifyHardDeleteByEmail,
  notifyMentorNamedByEmail,
  notifyProposerReassignedByEmail,
  notifyTransitionByEmail,
} from "./project-emails";
import {
  isEmbeddableStatus,
  refreshProjectEmbedding,
} from "./project-embeddings";

export interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

export interface TransitionOptions extends EmailOptions {
  embed?: EmbedFn;
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

  // Archived counts as well as published, so editing an archived project keeps
  // its vector truthful rather than leaving one computed from text nobody can
  // see any more. `isEmbeddableStatus` is the single spelling of that rule.
  if (isEmbeddableStatus(existing.status)) {
    await refreshProjectEmbedding(existing.id, embed);
  }

  return { id: existing.id, updated: true };
}

/**
 * The only writer of `proposerEmail` and `proposerId` after create (#322),
 * and of `studentProposed`, which says who proposed the project and so
 * belongs with the link rather than with mentorship (#336).
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
  data: ProposerInput,
  opts?: EmailOptions
): Promise<{ id: string; updated: boolean }> {
  assertStaff(viewer);
  const existing = await loadProjectOr404(data.id);
  const proposerEmail = normalizeEmailAddress(data.proposerEmail);
  const proposerId = proposerEmail
    ? await resolveProposerId(proposerEmail)
    : null;
  const newValues: Partial<typeof projects.$inferSelect> = {
    proposerEmail,
    proposerId,
    studentProposed: data.studentProposed,
  };
  const { changedFields, newDiff, oldDiff } = diffRowFields(
    existing,
    newValues
  );
  if (changedFields.length === 0) {
    return { id: existing.id, updated: false };
  }
  // Only a new address is news to anyone. Flipping the student-proposed mark
  // on its own, or re-saving the address that is already there, tells the
  // proposer nothing they do not know (#385); an unlink tells nobody, as the
  // notifiers already decide. Same gate as the mentor save.
  const reassigned = changedFields.includes("proposerEmail") && !!proposerEmail;
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
    // The new proposer's bell. Nothing when the address has no account; the
    // email below covers that one.
    if (reassigned) {
      await recordProposerReassignedNotification(
        tx,
        { id: existing.id, title: existing.title, proposerId },
        viewer.id
      );
    }
  });
  // After the transaction, never inside it; swallows its own errors. The
  // skip is the email's alone: the bell row above is written regardless.
  if (reassigned && (opts?.sendEmail ?? true)) {
    await notifyProposerReassignedByEmail(
      {
        actorId: viewer.id,
        project: {
          id: existing.id,
          proposerEmail,
          proposerId,
          title: existing.title,
        },
      },
      opts?.send
    );
  }
  return { id: existing.id, updated: true };
}

export async function updateProjectProposerForCurrentUser(
  data: ProposerInput & { sendEmail: boolean }
) {
  const viewer = await requireUser();
  const { sendEmail, ...fields } = data;
  return updateProjectProposerAs(viewer, fields, { sendEmail });
}

/**
 * The only writer of `mentorEmail`, which since #402 is the whole of
 * mentorship: no state beside it, so nothing to refuse and nothing for the
 * edit log to name but the address.
 *
 * Staff-only, and deliberately not part of `updateProjectAs`: the key does
 * not exist on `ProjectInput`, so the shared form cannot carry it and a
 * proposer has no endpoint that accepts it. That is what makes "staff edit
 * this" structural rather than a check someone remembers to keep.
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
  data: MentorshipInput,
  opts?: EmailOptions
): Promise<{ id: string; updated: boolean }> {
  assertStaff(viewer);
  const existing = await loadProjectOr404(data.id);
  const mentorEmail = normalizeEmailAddress(data.mentorEmail);
  const newValues: Partial<typeof projects.$inferSelect> = { mentorEmail };
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
  // Only a new address is news to anyone; clearing one mails nobody. After
  // the transaction, and it swallows its own errors.
  if (newValues.mentorEmail && (opts?.sendEmail ?? true)) {
    await notifyMentorNamedByEmail(
      {
        mentorEmail: newValues.mentorEmail,
        project: { id: existing.id, title: existing.title },
      },
      opts?.send
    );
  }
  return { id: existing.id, updated: true };
}

export async function updateProjectMentorshipForCurrentUser(
  data: MentorshipInput & { sendEmail: boolean }
) {
  const viewer = await requireUser();
  const { sendEmail, ...fields } = data;
  return updateProjectMentorshipAs(viewer, fields, { sendEmail });
}

/**
 * The programs a project runs in, in `course_id` order, as the edit log
 * stores them and the panel reads them back. Labels rather than ids, so a
 * row still reads as course names after a program is deleted.
 */
async function programLabelsFor(
  tx: Pick<typeof db, "select">,
  programIds: string[]
): Promise<string[]> {
  if (programIds.length === 0) {
    return [];
  }
  const rows = await tx
    .select({ courseId: programs.courseId, courseName: programs.courseName })
    .from(programs)
    .where(inArray(programs.id, programIds))
    .orderBy(asc(programs.courseId));
  return rows.map(programLabel);
}

/**
 * The only writer of `project_programs` (#450, #462), and staff only.
 * Placing a project in a program is a staff judgement about how the course
 * runs, not a fact the proposer reports, which is the same line #322 drew
 * for the proposer and the categories; ADR-0026 records the trade and
 * ADR-0028 records the move to a set.
 *
 * Not part of `updateProjectAs`: the key never entered `ProjectInput`, so
 * the shared form cannot carry it and a proposer has no endpoint that moves
 * their own project. A new project arrives with no rows here at all, and the
 * panel is where it gets placed.
 *
 * Delete then insert inside the transaction, the shape
 * `setProjectCategoriesAs` uses. Unlike that one this keeps its edit-log
 * row, which has to be hand rolled: `diffRowFields` reads columns off a row
 * and there is no column left to read.
 *
 * Compared as a set, not as two arrays. Checkbox order is whatever order
 * staff clicked in, and an array comparison would write a row claiming a
 * change every time somebody reordered nothing. The incoming ids are
 * deduped for the same reason the composite primary key exists.
 *
 * No embedding refresh, for the reason the proposer and mentor writers skip
 * one: the program is not part of the embedded text. It left
 * `buildProjectEmbeddingSource` in #463 (ADR-0025), which embeds a project's
 * prose and not its categories or programs.
 *
 * The scope assessment needs no call either, for a different reason: its
 * source hash covers each program's `term_count` and `getScopeAssessmentAs`
 * recomputes that hash on read, so a move already reports the stored verdict
 * as stale.
 */
export async function updateProjectProgramsAs(
  viewer: Viewer,
  data: ProgramsInput
): Promise<{ id: string; updated: boolean }> {
  assertStaff(viewer);
  const existing = await loadProjectOr404(data.id);
  const wanted = [...new Set(data.programIds)];
  const saved = await db
    .select({ programId: projectPrograms.programId })
    .from(projectPrograms)
    .where(eq(projectPrograms.projectId, existing.id));
  const savedIds = saved.map((r) => r.programId);
  // Both sides are already free of repeats, the saved one by the composite
  // primary key and the wanted one by the dedupe above, so equal sizes plus
  // containment is set equality.
  const savedSet = new Set(savedIds);
  if (
    savedSet.size === wanted.length &&
    wanted.every((id) => savedSet.has(id))
  ) {
    return { id: existing.id, updated: false };
  }
  await db.transaction(async (tx) => {
    // Inside the transaction, so a program deleted between the read and the
    // insert cannot leave the logged labels one short of the rows written.
    const [oldLabels, newLabels] = await Promise.all([
      programLabelsFor(tx, savedIds),
      programLabelsFor(tx, wanted),
    ]);
    await tx
      .delete(projectPrograms)
      .where(eq(projectPrograms.projectId, existing.id));
    if (wanted.length > 0) {
      await tx.insert(projectPrograms).values(
        wanted.map((programId) => ({
          projectId: existing.id,
          programId,
        }))
      );
    }
    // The project row itself is untouched by the placement now, but the
    // listing orders on `updated_at` and staff expect a move to surface the
    // project, which is what the single-column writer did.
    await tx
      .update(projects)
      .set({ updatedAt: new Date() })
      .where(eq(projects.id, existing.id));
    // Nothing renders these two columns: `EditLogEntry` carries four fields
    // and #467 kept the values out of both payloads. They are for whoever
    // reads `project_edit_log` in the database, which is why they are
    // labels and why they are ordered: an unordered array would differ on
    // nothing and make two identical sets look like a change.
    await tx.insert(projectEditLog).values({
      projectId: existing.id,
      editorId: viewer.id,
      changedFields: ["programs"],
      oldValues: { programs: oldLabels },
      newValues: { programs: newLabels },
    });
  });
  return { id: existing.id, updated: true };
}

export async function updateProjectProgramsForCurrentUser(data: ProgramsInput) {
  return updateProjectProgramsAs(await requireUser(), data);
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
 * Staff sending a submission back to draft owe the proposer a reason, the
 * same as changes requested: the proposer is emailed, and a message that
 * says only "returned to draft" tells them nothing. Role-gated here rather
 * than in `commitTransition` because the owner reaches the same target by
 * withdrawing, and nobody owes themselves an explanation. `forceTransitionAs`
 * skips it on purpose: it is the escape hatch, and the email it sends
 * tolerates a missing comment.
 */
function assertStaffReturnToDraftHasComment(
  target: ProjectStatus,
  comment: string | null
): void {
  if (target === "draft" && !comment?.trim()) {
    throw new Error(
      "A comment explaining why the project was returned to draft is required so the proposer knows what to change."
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
  // status it finds is one `isEmbeddableStatus` names, so getting the order
  // wrong gives you a project that publishes and never embeds.
  //
  // Archiving lands here too, and costs nothing: the hash still matches the
  // text, so the refresh returns "unchanged" and the vector the project had
  // while published stays put. The one case it does work is a project that
  // failed to embed at publish time, which archiving now retries.
  if (isEmbeddableStatus(target)) {
    await refreshProjectEmbedding(project.id, opts?.embed);
  }

  // Same reasoning, and it matters more here: a failed email must not undo an
  // approval. notifyTransitionByEmail swallows its own errors.
  await notifyTransitionByEmail(
    {
      actorId,
      comment,
      project: {
        description: project.description,
        id: project.id,
        proposerEmail: project.proposerEmail,
        proposerId: project.proposerId,
        title: project.title,
      },
      sendEmail: opts?.sendEmail ?? true,
      target,
    },
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
  if (role === "staff") {
    assertStaffReturnToDraftHasComment(target, comment ?? null);
  }
  // Skipping the mail is a staff affordance, so the decision is made here from
  // the role rather than read off the request. `sendEmail` cannot be gated by
  // the schema instead: five owner-reachable endpoints carry it (the three
  // transition ones, the comment and the hard delete), and one of them is
  // `performTransition`, which takes its target status from the wire and so
  // serves staff and owners through the same validator. Without this a
  // proposer could submit and suppress the notice to EMAIL_STAFF_INBOX, which
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
  id: string,
  opts?: EmailOptions
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
  // The proposer's in-app row would link to a page that now 404s, so the
  // only channel left is email. Sent last, and it swallows its own errors.
  // The skip is staff's, decided from the role as in `performTransitionAs`;
  // an owner deleting their own draft is never emailed anyway.
  if (isStaff(viewer) ? (opts?.sendEmail ?? true) : true) {
    await notifyHardDeleteByEmail(
      {
        actorId: viewer.id,
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

export async function hardDeleteProjectForCurrentUser(
  id: string,
  sendEmail: boolean
) {
  const viewer = await requireUser();
  return hardDeleteProjectAs(viewer, id, { sendEmail });
}
