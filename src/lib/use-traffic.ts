import { type ParsedLocation, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  isTrafficRoute,
  type TrafficBody,
  type TrafficLocation,
  trafficKind,
} from "./traffic-scope";

/**
 * Whether this document has sent its referrer yet. Module state, so a
 * remount of the public layout after a detour through a signed-in page does
 * not send it twice; it only ever changes inside an effect, so the server
 * never touches it.
 */
let referrerSent = false;

/** For tests: forget that this document sent its referrer. */
export function resetTrafficDocument(): void {
  referrerSent = false;
}

/**
 * Fire and forget. Never awaited, never read, no retry and no queue.
 * `keepalive` lets a send that starts just before the tab closes finish, and
 * `credentials: "omit"` keeps the session cookie from ever reaching the
 * traffic writer, which has no use for it.
 */
function send(body: TrafficBody): void {
  fetch("/api/traffic", {
    method: "POST",
    keepalive: true,
    credentials: "omit",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {
    // Nothing to do: a lost page view is not worth a console line.
  });
}

/**
 * Records page views and search changes on public routes (#591). Rendered by
 * the `_public` layout, so it runs only while a public route is showing.
 *
 * Sends once on mount for the location already resolved, because hydration
 * does not emit `onResolved` and the landing page of every visit would be
 * lost otherwise (#507), then once per `onResolved`. Preloading does not
 * emit, so a hovered link sends nothing. Reads no cookie and writes no
 * storage.
 */
export function useTraffic(): void {
  const router = useRouter();

  useEffect(() => {
    let last: TrafficLocation | null = null;

    const record = (location: ParsedLocation) => {
      const matches = router.state.matches;
      if (!isTrafficRoute(matches.map((m) => m.routeId))) {
        return;
      }
      const kind = trafficKind(last, location);
      if (!kind) {
        return;
      }
      const body: TrafficBody = { kind, pathname: location.pathname };
      // The leaf's validated search holds only the keys its route's schema
      // defines; `match.search` would also carry any stray key in the URL.
      const search = matches.at(-1)?._strictSearch as
        | Record<string, unknown>
        | undefined;
      if (search && Object.keys(search).length > 0) {
        body.search = search;
      }
      if (last) {
        body.previousPath = last.pathname;
      }
      if (!referrerSent) {
        referrerSent = true;
        if (document.referrer) {
          body.referrer = document.referrer;
        }
      }
      last = { pathname: location.pathname, searchStr: location.searchStr };
      send(body);
    };

    record(router.state.resolvedLocation ?? router.state.location);
    return router.subscribe("onResolved", ({ toLocation }) =>
      record(toLocation)
    );
  }, [router]);
}
