/**
 * The image key a save should write, for a project or an inventory item alike.
 *
 * This exists to make one rule observable rather than incidental: the upload
 * happens BEFORE the row is written, never after. Both edit paths used to save
 * the row and then upload, which kept the image change out of the edit log and
 * left the edit half applied when the upload failed (#88, #126). Expressing the
 * key as a value the save consumes means the two cannot be reordered without
 * the key having no way to reach the write.
 *
 * Takes the uploader as a parameter so a test can drive every branch and the
 * rejection without a server. The owner arrives as one object rather than a
 * field name beside a separate id, which removes the mismatch worth removing:
 * two arguments that have to agree and nothing making them. It does not stop
 * a caller putting an item id under the `projectId` key; nothing in this
 * union's shape does, and branding the two id types is not worth it here.
 *
 * Removal needs no branch here: both uploaders clear the form's image field
 * when the user clicks Remove, so `currentImageUrl` is already empty. What
 * "empty" means differs by form ("" for projects, null for inventory) and this
 * passes either through untouched, because the schemas accept both.
 */
export async function imageUrlToSave(args: {
  currentImageUrl: string | null;
  owner: { itemId: string } | { projectId: string };
  pendingImage: File | null | undefined;
  upload: (opts: { data: FormData }) => Promise<{ key: string }>;
}): Promise<string | null> {
  const { currentImageUrl, owner, pendingImage, upload } = args;
  if (!(pendingImage instanceof File)) {
    return currentImageUrl;
  }
  const form = new FormData();
  const [field, id] =
    "projectId" in owner
      ? ["projectId", owner.projectId]
      : ["itemId", owner.itemId];
  form.append(field, id);
  form.append("file", pendingImage);
  const { key } = await upload({ data: form });
  return key;
}
