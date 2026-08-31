/**
 * One upload policy for every image this app accepts: project images,
 * inventory photos and avatars alike.
 *
 * Client-safe on purpose. The server guard and the file picker's `accept`
 * attribute have to agree about which types are allowed, and the only way to
 * keep them agreeing is to have them read the same constant. This was three
 * copies with nothing keeping them in step, so adding a type to one silently
 * gave the app two upload policies depending on which form the user was
 * filling in. QUIRKS lists who reads this; do not repeat the list here.
 *
 * If a reason ever emerges for one surface to allow something another must
 * not, write the reason down here and split the constant deliberately rather
 * than letting two copies drift.
 */

export const ALLOWED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/** 10MB, which is generous for anything that has been through the client resize. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/** The same allowlist in the form `<input type="file" accept>` wants. */
export const IMAGE_FILE_ACCEPT = [...ALLOWED_IMAGE_TYPES].join(",");

/**
 * The server-side guard. Every upload surface renders the thrown message
 * verbatim, and `uploads.integration.test.ts` matches on
 * `Unsupported image type`, so changing the wording is a user-visible change
 * with one test to update.
 */
export function assertImageFile(file: unknown): asserts file is File {
  if (!(file instanceof File)) {
    throw new Error("Missing file");
  }
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error("Unsupported image type");
  }
  if (file.size > MAX_IMAGE_BYTES) {
    throw new Error(`File too large (max ${MAX_IMAGE_BYTES} bytes)`);
  }
}
