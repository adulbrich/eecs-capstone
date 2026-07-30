import { getPublicUrl } from "./storage";

/**
 * Shipped in `public/`, so it is a plain absolute path and must NOT be run
 * through `getPublicUrl` (that prefixes the object-storage base). Generated
 * from the OSU Capstone generic logo, padded to 16:9 to match the aspect ratio
 * every project image renders at.
 */
export const PROJECT_PLACEHOLDER_IMAGE = "/project-placeholder.webp";

/**
 * Resolves the image a project should display. The placeholder is presentation
 * only and is never written to `projects.image_url`: storing it would make
 * "this project has no image of its own" unrecoverable, and would break the
 * uploader's Remove action.
 */
export function projectImageSrc(imageUrl: string | null | undefined): string {
  return getPublicUrl(imageUrl) ?? PROJECT_PLACEHOLDER_IMAGE;
}
