import { describe, expect, it } from "vitest";
import { stripCacheHeadersFromAssetErrors } from "#/lib/_internal/asset-error-headers";

/**
 * The hook is the seam: Nitro calls it with the final Response and the event
 * for every response, static assets and errors included. The route rule it
 * corrects is Nitro's own default for `/assets/**`, which stamps the
 * immutable header on a 404 too, and CloudFront then caches that 404 for the
 * full max-age (#397).
 */
function respond(status: number, pathname: string) {
  const res = new Response(null, {
    status,
    headers: { "cache-control": "public, max-age=31536000, immutable" },
  });
  const event = { req: { url: `http://localhost:3000${pathname}` } };
  stripCacheHeadersFromAssetErrors(res, event);
  return res.headers.get("cache-control");
}

describe("stripCacheHeadersFromAssetErrors", () => {
  it("replaces the immutable header on a missing asset with no-store", () => {
    expect(respond(404, "/assets/styles-gone.css")).toBe("no-store");
  });

  it("leaves a served asset immutable", () => {
    expect(respond(200, "/assets/styles-here.css")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("leaves errors outside /assets/ alone", () => {
    expect(respond(404, "/projects/nope")).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("covers server errors on an asset path, not only 404", () => {
    expect(respond(500, "/assets/styles-here.css")).toBe("no-store");
  });
});
