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
 * rejection without a server, and takes the owner field name because that is
 * the only thing that differs between the two domains.
 *
 * Removal needs no branch here: both uploaders clear the form's image field
 * when the user clicks Remove, so `currentImageUrl` is already empty. What
 * "empty" means differs by form ("" for projects, null for inventory) and this
 * passes either through untouched, because the schemas accept both.
 */
export async function imageUrlToSave<Current extends string | null>(args: {
  currentImageUrl: Current;
  ownerField: "itemId" | "projectId";
  ownerId: string;
  pendingImage: File | null | undefined;
  upload: (opts: { data: FormData }) => Promise<{ key: string }>;
}): Promise<Current | string> {
  const { currentImageUrl, ownerField, ownerId, pendingImage, upload } = args;
  if (!(pendingImage instanceof File)) {
    return currentImageUrl;
  }
  const form = new FormData();
  form.append(ownerField, ownerId);
  form.append("file", pendingImage);
  const { key } = await upload({ data: form });
  return key;
}
