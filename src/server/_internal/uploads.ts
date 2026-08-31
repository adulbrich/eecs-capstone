import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { assertImageFile } from "#/lib/image-upload-policy";
import { canEditProject } from "#/lib/project-visibility";

interface AuthUser {
  id: string;
  /**
   * The viewer's current avatar key. Only the avatar paths read it, to delete
   * the object the new one replaces, and it is optional because
   * uploadProjectImageAs has no use for it.
   */
  image?: string | null | undefined;
  role?: string | null | undefined;
}

/**
 * Stores a project image and returns its key. Deliberately writes no row.
 *
 * The caller passes the key into `updateProject` as an ordinary field, which
 * buys three things this function cannot: the change goes through
 * `diffRowFields` and lands in `project_edit_log` like every other edit, a
 * failed upload leaves the project untouched rather than half saved, and the
 * object the key replaces is deleted by whoever owns the column. It used to
 * write `projects.imageUrl` on its own request, which is why an image change
 * was the one edit the log never showed. See #88.
 *
 * The guard stays here regardless: this writes into a project's key space, so
 * it has to know the viewer may edit that project.
 */
export async function uploadProjectImageAs(
  viewer: AuthUser,
  form: FormData
): Promise<{ key: string }> {
  const projectId = String(form.get("projectId") ?? "");
  if (!projectId) {
    throw new Error("Missing projectId");
  }
  const file = form.get("file");
  assertImageFile(file);

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) {
    throw new Error("Project not found");
  }
  if (!canEditProject(project, { id: viewer.id, role: viewer.role ?? null })) {
    throw new Error("Forbidden");
  }

  const input = Buffer.from(await file.arrayBuffer());
  const { processImage } = await import("#/lib/_internal/image-processing");
  const { buffer, contentType } = await processImage(input, {
    maxWidth: 1600,
    maxHeight: 900,
  });

  const key = `projects/${projectId}/${randomUUID()}.webp`;
  const { getObjectStorage } = await import("#/lib/_internal/storage");
  await getObjectStorage().put(key, buffer, contentType);

  return { key };
}

export async function uploadProjectImageForCurrentUser(form: FormData) {
  const viewer = await requireUser();
  return uploadProjectImageAs(viewer, form);
}

export async function uploadAvatarAs(viewer: AuthUser, form: FormData) {
  const file = form.get("file");
  assertImageFile(file);

  const input = Buffer.from(await file.arrayBuffer());
  const { processImage } = await import("#/lib/_internal/image-processing");
  const { buffer, contentType } = await processImage(input, {
    maxWidth: 512,
    maxHeight: 512,
  });

  const key = `avatars/${viewer.id}/${randomUUID()}.webp`;
  const { getObjectStorage } = await import("#/lib/_internal/storage");
  const storage = getObjectStorage();
  await storage.put(key, buffer, contentType);

  const previousImage = viewer.image;
  await db
    .update(user)
    .set({ image: key, updatedAt: new Date() })
    .where(eq(user.id, viewer.id));

  // After the write, and scoped to the viewer's own key space: an OAuth
  // account's `user.image` is a remote URL, which fails the prefix check.
  const { deleteReplacedObject } = await import("#/lib/_internal/storage");
  await deleteReplacedObject(previousImage, `avatars/${viewer.id}/`);

  return { key };
}

export async function clearAvatarAs(viewer: AuthUser) {
  const previousImage = viewer.image;
  await db
    .update(user)
    .set({ image: null, updatedAt: new Date() })
    .where(eq(user.id, viewer.id));
  const { deleteReplacedObject } = await import("#/lib/_internal/storage");
  await deleteReplacedObject(previousImage, `avatars/${viewer.id}/`);
  return { ok: true as const };
}

export async function uploadAvatarForCurrentUser(form: FormData) {
  const viewer = await requireUser();
  return uploadAvatarAs(viewer, form);
}

export async function clearAvatarForCurrentUser() {
  const viewer = await requireUser();
  return clearAvatarAs(viewer);
}
