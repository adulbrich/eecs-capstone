import { eq } from "drizzle-orm";
import { db } from "#/db";
import { inventoryItems } from "#/db/schema";
import { requireUser } from "#/lib/_internal/auth-guards";
import { assertImageFile } from "#/lib/image-upload-policy";
import { assertStaff, type Viewer } from "#/lib/viewer";

/**
 * Stores an inventory photo and returns its key. Writes no row, for the same
 * three reasons the project upload does not (#88): the change lands in
 * `inventory_item_edit_log` through `diffRowFields` like every other column, a
 * failed upload leaves the item untouched instead of half saved, and the object
 * the key replaces is deleted by whoever owns the column.
 *
 * The item is still loaded, because a photo may only be stored under an item
 * that exists, and `assertStaff` still gates the whole thing.
 *
 * The cost, stated because it is a trade and not a free win: an upload whose
 * save then fails leaves an object nothing references.
 */
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

  const { getObjectStorage, inventoryImageKeys } = await import(
    "#/lib/_internal/storage"
  );
  const key = inventoryImageKeys(itemId).newKey();
  await getObjectStorage().put(key, buffer, contentType);

  return { key };
}

export async function uploadInventoryImageForCurrentUser(form: FormData) {
  const viewer = await requireUser();
  return uploadInventoryImageAs(viewer, form);
}
