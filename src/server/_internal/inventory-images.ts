import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "#/db";
import { inventoryItems } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { assertImageFile } from "#/lib/image-upload-policy";
import { assertStaff, type Viewer } from "#/lib/viewer";

export async function uploadInventoryImageAs(
  viewer: Viewer,
  form: FormData
): Promise<{ key: string }> {
  assertStaff(viewer);
  const itemId = String(form.get("itemId") ?? "");
  if (!itemId) {
    throw new Error("Missing itemId");
  }
  const file = form.get("file");
  assertImageFile(file);

  const [item] = await db
    .select()
    .from(inventoryItems)
    .where(eq(inventoryItems.id, itemId));
  if (!item) {
    throw new Error("Item not found");
  }

  const input = Buffer.from(await file.arrayBuffer());
  const { processImage } = await import("#/lib/_internal/image-processing");
  const { buffer, contentType } = await processImage(input, {
    maxWidth: 1200,
    maxHeight: 1200,
  });

  const key = `inventory/${itemId}/${randomUUID()}.webp`;
  const { getObjectStorage } = await import("#/lib/_internal/storage");
  const storage = getObjectStorage();
  await storage.put(key, buffer, contentType);

  const previousKey = item.imageUrl;
  await db
    .update(inventoryItems)
    .set({ imageUrl: key, updatedAt: new Date() })
    .where(eq(inventoryItems.id, itemId));

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

export async function uploadInventoryImageForCurrentUser(form: FormData) {
  const viewer = await requireUser();
  return uploadInventoryImageAs(viewer, form);
}
