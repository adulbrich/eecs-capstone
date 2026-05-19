import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { projects, user } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { canEditProject } from "#/lib/project-visibility";

const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const MAX_INPUT_BYTES = 10 * 1024 * 1024; // 10MB after client resize is generous

function assertImageFile(file: unknown): asserts file is File {
  if (!(file instanceof File)) {
    throw new Error("Missing file");
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    throw new Error("Unsupported image type");
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(`File too large (max ${MAX_INPUT_BYTES} bytes)`);
  }
}

export async function uploadProjectImageForCurrentUser(form: FormData) {
  const viewer = await requireUser();
  const projectId = String(form.get("projectId") ?? "");
  if (!projectId) throw new Error("Missing projectId");
  const file = form.get("file");
  assertImageFile(file);

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) throw new Error("Project not found");
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
  const storage = getObjectStorage();
  await storage.put(key, buffer, contentType);

  const previousKey = project.imageUrl;
  await db
    .update(projects)
    .set({ imageUrl: key, updatedAt: new Date() })
    .where(eq(projects.id, projectId));

  // Best-effort cleanup of the previous key (skip http(s) legacy URLs).
  if (
    previousKey &&
    !previousKey.startsWith("http://") &&
    !previousKey.startsWith("https://")
  ) {
    storage.delete(previousKey).catch((e) => {
      console.warn(`Failed to delete previous key ${previousKey}:`, e);
    });
  }

  return { key };
}

export async function uploadAvatarForCurrentUser(form: FormData) {
  const viewer = await requireUser();
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

  if (
    previousImage &&
    !previousImage.startsWith("http://") &&
    !previousImage.startsWith("https://")
  ) {
    storage.delete(previousImage).catch((e) => {
      console.warn(`Failed to delete previous avatar ${previousImage}:`, e);
    });
  }

  return { key };
}

export async function clearAvatarForCurrentUser() {
  const viewer = await requireUser();
  const previousImage = viewer.image;
  await db
    .update(user)
    .set({ image: null, updatedAt: new Date() })
    .where(eq(user.id, viewer.id));
  if (
    previousImage &&
    !previousImage.startsWith("http://") &&
    !previousImage.startsWith("https://")
  ) {
    const { getObjectStorage } = await import("#/lib/_internal/storage");
    getObjectStorage()
      .delete(previousImage)
      .catch((e) => {
        console.warn(`Failed to delete previous avatar ${previousImage}:`, e);
      });
  }
  return { ok: true as const };
}
