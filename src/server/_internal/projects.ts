import { eq } from "drizzle-orm";
import { db } from "#/db";
import { projectEditLog, projectStatusHistory, projects } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { canEditProject, isStaff, type Viewer } from "#/lib/project-visibility";
import {
  type ActorRole,
  assertTransitionAllowed,
  type Status,
} from "#/lib/project-workflow";
import type { ProjectInput, UpdateProjectInput } from "../projects";
import {
  recordSoftDeleteNotification,
  recordStatusChangeNotifications,
} from "./notify";

export interface AuthUser {
  id: string;
  role?: string | null | undefined;
}

const PROJECT_EDITABLE_FIELDS = [
  "title",
  "description",
  "problemStatement",
  "objectives",
  "minQualifications",
  "prefQualifications",
  "url",
  "contactEmail",
  "contactName",
  "imageUrl",
  "licenseRestrictions",
  "programId",
  "notes",
] as const;

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

export async function createProjectAs(
  viewer: AuthUser,
  data: ProjectInput
): Promise<{ id: string }> {
  const allowedNotes = isStaff(viewerToVisibility(viewer))
    ? (data.notes ?? null)
    : null;

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
      licenseRestrictions: data.licenseRestrictions ?? null,
      programId: data.programId ?? null,
      notes: allowedNotes,
      proposerId: viewer.id,
      status: "draft",
    })
    .returning();
  return { id: created.id };
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: TODO large update path, decompose field-diffing in a follow-up
export async function updateProjectAs(
  viewer: AuthUser,
  data: UpdateProjectInput
): Promise<{ id: string; updated: boolean }> {
  const visibility = viewerToVisibility(viewer);
  const existing = await loadProjectOr404(data.id);
  if (!canEditProject(existing, visibility)) {
    throw new Error("Forbidden");
  }
  const staff = isStaff(visibility);

  const newValues: Record<string, unknown> = {
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
    licenseRestrictions: data.licenseRestrictions ?? null,
    programId: data.programId ?? null,
  };
  if (staff) {
    newValues.notes = data.notes ?? null;
  }

  const oldDiff: Record<string, unknown> = {};
  const newDiff: Record<string, unknown> = {};
  const changedFields: string[] = [];
  for (const field of PROJECT_EDITABLE_FIELDS) {
    if (!staff && field === "notes") {
      continue;
    }
    const oldVal = (existing as Record<string, unknown>)[field] ?? null;
    const newVal = newValues[field] ?? null;
    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      oldDiff[field] = oldVal;
      newDiff[field] = newVal;
      changedFields.push(field);
    }
  }

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

export async function performTransitionAs(
  viewer: AuthUser,
  id: string,
  target: Status,
  comment?: string
): Promise<{ id: string; status: Status }> {
  const visibility = viewerToVisibility(viewer);
  const project = await loadProjectOr404(id);
  if (!isStaff(visibility) && project.proposerId !== viewer.id) {
    throw new Error("Forbidden");
  }
  const role: ActorRole = isStaff(visibility) ? "staff" : "owner";
  assertTransitionAllowed(project.status as Status, target, role);

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
    await tx.update(projects).set(updates).where(eq(projects.id, id));

    await tx.insert(projectStatusHistory).values({
      projectId: id,
      oldStatus: project.status,
      newStatus: target,
      changedBy: viewer.id,
      comment: comment ?? null,
    });

    await recordStatusChangeNotifications(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      target,
      viewer.id
    );
  });

  return { id, status: target };
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
  return { id };
}

export async function forceTransitionAs(
  viewer: AuthUser,
  id: string,
  target: Status,
  comment?: string
): Promise<{ id: string; status: Status }> {
  const visibility = viewerToVisibility(viewer);
  if (!isStaff(visibility)) {
    throw new Error("Forbidden");
  }
  const project = await loadProjectOr404(id);
  if (project.status === target) {
    throw new Error("Project is already in that status.");
  }

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
    await tx.update(projects).set(updates).where(eq(projects.id, id));

    await tx.insert(projectStatusHistory).values({
      projectId: id,
      oldStatus: project.status,
      newStatus: target,
      changedBy: viewer.id,
      comment: comment ?? null,
    });

    await recordStatusChangeNotifications(
      tx,
      { id: project.id, title: project.title, proposerId: project.proposerId },
      target,
      viewer.id
    );
  });

  return { id, status: target };
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
  comment?: string
) {
  const viewer = await requireUser();
  return performTransitionAs(viewer, id, target, comment);
}

export async function forceTransitionForCurrentUser(
  id: string,
  target: Status,
  comment?: string
) {
  const viewer = await requireUser();
  return forceTransitionAs(viewer, id, target, comment);
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
