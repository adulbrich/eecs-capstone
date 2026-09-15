import type { NitroRuntimeHooks } from "nitro/types";

type ResponseEvent = Parameters<NitroRuntimeHooks["response"]>[1];

/**
 * Nitro's Vite plugin gives `/assets/**` a route rule with
 * `cache-control: public, max-age=31536000, immutable`, and a route rule's
 * headers land on every response for the path, a 404 included. CloudFront
 * caches a 404 for the longer of its error minimum TTL and the origin's
 * max-age, so a missing asset was pinned at an edge for a year. That window
 * opens on every rolling deploy, while the old task still answers for hashes
 * only the new image has (#397). With no max-age on the error, CloudFront
 * falls back to its 10 second error minimum.
 *
 * Registered by `src/nitro/asset-error-headers.ts`; the logic lives here so a
 * unit test can call it without importing the Nitro runtime.
 */
export function stripCacheHeadersFromAssetErrors(
  res: Response,
  event: { req: Pick<ResponseEvent["req"], "url"> }
) {
  if (
    res.status >= 400 &&
    new URL(event.req.url).pathname.startsWith("/assets/")
  ) {
    res.headers.set("cache-control", "no-store");
  }
}
