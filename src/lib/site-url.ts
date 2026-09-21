/**
 * The site's own origin, for the handful of tags that cannot use a relative
 * path.
 *
 * `og:image` and `<link rel="canonical">` are both specified as absolute URLs,
 * and a scraper fetching the page has no base to resolve a relative one
 * against. Every other link in the app stays relative.
 *
 * Client-safe and built the same way as `STORAGE_PUBLIC_BASE` in `storage.ts`:
 * a `VITE_` variable, read through `import.meta.env` so Vite inlines it at
 * build time, because `head()` runs on both sides of the SSR boundary and
 * `process.env` is not there on the client. `BETTER_AUTH_URL` is the same value
 * in production but is server-only, so it cannot be the source here.
 *
 * `.github/workflows/deploy.yml` injects the real origin beside
 * `VITE_STORAGE_PUBLIC_BASE`. The fallback is the dev server's origin, which is
 * pinned to port 3000 by `BETTER_AUTH_URL` (sign-in breaks on any other port),
 * so an unset variable in development produces working tags rather than
 * relative ones a scraper would drop.
 */
const LEADING_SLASHES = /^\/+/;
const TRAILING_SLASHES = /\/+$/;
const ABSOLUTE = /^https?:\/\//i;

const CONFIGURED =
  typeof import.meta === "undefined"
    ? undefined
    : (import.meta as unknown as { env?: Record<string, string> }).env
        ?.VITE_SITE_URL;

const SITE_URL = (CONFIGURED ?? "http://localhost:3000").replace(
  TRAILING_SLASHES,
  ""
);

export const SITE_ORIGIN = SITE_URL;

/**
 * Absolutizes an in-app path. A value that is already absolute passes through
 * unchanged, so a caller does not have to know which it is holding.
 */
export function absoluteUrl(path: string): string {
  if (ABSOLUTE.test(path)) {
    return path;
  }
  return `${SITE_ORIGIN}/${path.replace(LEADING_SLASHES, "")}`;
}
