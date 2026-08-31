/**
 * One upload policy for every image this app accepts: project images,
 * inventory photos and avatars alike.
 *
 * Client-safe on purpose. The server guard and the file picker's `accept`
 * attribute have to agree about which types are allowed, and the only way to
 * keep them agreeing is to have them read the same constant. This module was
 * two private copies in `_internal/uploads.ts` and `_internal/inventory-images.ts`
 * plus a hardcoded string in `image-uploader.tsx`; nothing kept the three in
 * step, so adding a type to one silently gave the app two upload policies
 * depending on which form the user was filling in.
 *
 * If a reason ever emerges for one surface to allow something another must
 * not, write the reason down here and split the constant deliberately rather
 * than letting two copies drift.
 */

export const ALLOWED_IMAGE_TYPES = new Set([
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
 * The server-side guard. Messages are load-bearing: the integration suites
 * and the forms' error handling both match on them, so change them only
 * with those call sites.
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
