import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isTrafficRoute, trafficKind } from "#/lib/traffic-scope";

/**
 * Every full route id the generated tree declares, read off the
 * `FileRoutesById` interface on disk, so a route added anywhere is held to
 * the predicate without anyone remembering this file.
 */
const GENERATED = readFileSync(
  join(process.cwd(), "src/routeTree.gen.ts"),
  "utf8"
);
const BY_ID = GENERATED.slice(
  GENERATED.indexOf("export interface FileRoutesById {"),
  GENERATED.indexOf("}", GENERATED.indexOf("export interface FileRoutesById {"))
);
const ROUTE_IDS = [...BY_ID.matchAll(/^ {2}'([^']+)': typeof/gm)].map(
  (m) => m[1]
);

/**
 * The ids a resolved match list holds for `id`: the root, then every
 * declared id that is an ancestor of it segment by segment, then `id`.
 */
function chain(id: string): string[] {
  const ancestors = ROUTE_IDS.filter(
    (other) => other !== id && id.startsWith(`${other}/`)
  );
  return ["__root__", ...ancestors, id];
}

describe("isTrafficRoute against the generated route tree", () => {
  it("reads a route tree with public and signed-in routes in it", () => {
    expect(ROUTE_IDS).toContain("/_public");
    expect(ROUTE_IDS).toContain("/_public/projects/$projectId");
    expect(ROUTE_IDS.some((id) => id.startsWith("/_authed/"))).toBe(true);
  });

  it("records every route inside _public", () => {
    const publicIds = ROUTE_IDS.filter((id) => id.startsWith("/_public/"));
    expect(publicIds.length).toBeGreaterThanOrEqual(6);
    for (const id of publicIds) {
      expect(isTrafficRoute(chain(id)), id).toBe(true);
    }
  });

  it("refuses every route outside _public, signed-in and auth routes included", () => {
    const outside = ROUTE_IDS.filter(
      (id) => id !== "/_public" && !id.startsWith("/_public/")
    );
    expect(outside).toContain("/_authed");
    expect(outside.some((id) => id.startsWith("/(auth)/"))).toBe(true);
    for (const id of outside) {
      expect(isTrafficRoute(chain(id)), id).toBe(false);
    }
  });

  it("refuses a not-found that resolves to the root alone", () => {
    expect(isTrafficRoute(["__root__"])).toBe(false);
    expect(isTrafficRoute([])).toBe(false);
  });

  it("refuses a mixed list, so a layout that outlives its route sends nothing", () => {
    expect(
      isTrafficRoute(["__root__", "/_public", "/_authed/admin/analytics"])
    ).toBe(false);
  });

  it("does not take a lookalike prefix for the layout", () => {
    expect(isTrafficRoute(["__root__", "/_publicity", "/_publicity/x"])).toBe(
      false
    );
  });
});

describe("trafficKind", () => {
  const at = (pathname: string, searchStr = "") => ({ pathname, searchStr });

  it("calls the first send of a document a view", () => {
    expect(trafficKind(null, at("/projects", "?q=robot"))).toBe("view");
  });

  it("calls a new pathname a view", () => {
    expect(trafficKind(at("/projects"), at("/projects/abc"))).toBe("view");
  });

  it("calls a new search string on the same pathname a search", () => {
    expect(trafficKind(at("/projects"), at("/projects", "?view=table"))).toBe(
      "search"
    );
  });

  it("sends nothing when the same href resolves again", () => {
    expect(
      trafficKind(at("/projects", "?q=a"), at("/projects", "?q=a"))
    ).toBeNull();
  });
});
