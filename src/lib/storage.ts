/**
 * Client-safe storage helpers. Builds public URLs for object-storage
 * keys without importing any server SDK.
 *
 * Storage keys look like `projects/<projectId>/<uuid>.webp` or
 * `avatars/<userId>/<uuid>.webp`. Legacy values may be full URLs
 * (e.g., GitHub OAuth image, DiceBear identicon); those pass through
 * unchanged.
 */
const LEADING_SLASHES = /^\/+/;

const PUBLIC_BASE =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: Record<string, string> }).env
      ?.VITE_STORAGE_PUBLIC_BASE) ??
  "/storage";

export const STORAGE_PUBLIC_BASE = PUBLIC_BASE;

export function getPublicUrl(key: string | null | undefined): string | null {
  if (!key) {
    return null;
  }
  if (key.startsWith("http://") || key.startsWith("https://")) {
    return key;
  }
  return `${PUBLIC_BASE}/${key.replace(LEADING_SLASHES, "")}`;
}
