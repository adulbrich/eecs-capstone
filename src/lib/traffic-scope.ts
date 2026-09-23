/**
 * Which routes the traffic writer records, and what it sends for them.
 * Pure and client-safe: the hook in `use-traffic.ts` calls these before every
 * send, and the unit tests hold them to the route ids in `routeTree.gen.ts`.
 */

/** The pathless layout every recorded route sits under (#591). */
export const PUBLIC_LAYOUT_ID = "/_public";

const ROOT_ROUTE_ID = "__root__";

/**
 * True only when every resolved match other than the root sits inside
 * `_public`, and `_public` itself is among them. A `/_authed` or `(auth)`
 * route, or a not-found that resolves to the root alone, is never recorded,
 * even if the layout outlives the navigation that left it.
 */
export function isTrafficRoute(routeIds: readonly string[]): boolean {
  const below = routeIds.filter((id) => id !== ROOT_ROUTE_ID);
  return (
    below.includes(PUBLIC_LAYOUT_ID) &&
    below.every(
      (id) => id === PUBLIC_LAYOUT_ID || id.startsWith(`${PUBLIC_LAYOUT_ID}/`)
    )
  );
}

export type TrafficKind = "view" | "search";

export interface TrafficLocation {
  pathname: string;
  searchStr: string;
}

/**
 * What a resolved location is worth recording as, or null for nothing.
 *
 * The first send of a document is a `view`. After that a new pathname is a
 * `view`, a new search string alone is a `search`, and a hash-only change, or
 * the same href resolving again, is nothing.
 */
export function trafficKind(
  previous: TrafficLocation | null,
  next: TrafficLocation
): TrafficKind | null {
  if (!previous) {
    return "view";
  }
  if (previous.pathname !== next.pathname) {
    return "view";
  }
  if (previous.searchStr !== next.searchStr) {
    return "search";
  }
  return null;
}

/** The body `/api/traffic` accepts. `src/lib/_internal/traffic-request.ts` validates it. */
export interface TrafficBody {
  kind: TrafficKind;
  pathname: string;
  previousPath?: string;
  referrer?: string;
  search?: Record<string, unknown>;
}
