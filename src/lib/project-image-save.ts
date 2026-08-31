/**
 * The image key a project save should write.
 *
 * This exists to make one rule observable rather than incidental: the upload
 * happens BEFORE the row is written, never after. The old edit path saved the
 * row and then uploaded, which lost the image change from the edit log and
 * left the edit half applied when the upload failed (#88). Expressing it as a
 * value the save then consumes means the two cannot be reordered without the
 * key having no way to reach the write.
 *
 * Takes the uploader as a parameter so a test can drive both branches and the
 * rejection without a server. Both project routes call it, which is also why
 * the FormData assembly is spelled once.
 *
 * Removal needs no branch here: the uploader clears the form's `imageUrl`
 * field when the user clicks Remove, so `currentImageUrl` is already "".
 */
export async function projectImageUrlToSave(args: {
  currentImageUrl: string;
  pendingImage: File | null;
  projectId: string;
  upload: (opts: { data: FormData }) => Promise<{ key: string }>;
}): Promise<string> {
  const { currentImageUrl, pendingImage, projectId, upload } = args;
  if (!pendingImage) {
    return currentImageUrl;
  }
  const form = new FormData();
  form.append("projectId", projectId);
  form.append("file", pendingImage);
  const { key } = await upload({ data: form });
  return key;
}
