import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useTraffic } from "#/lib/use-traffic";

/**
 * Pathless layout for the public pages: the landing page, the project and
 * inventory listings and pages, and `/privacy`. Its only job is the traffic
 * writer's client hook, which is why signed-in and auth routes sit outside
 * it (#591). A sibling of `_authed`, not a child, so the QUIRKS warning about
 * a pathless layout under a pathless layout does not apply.
 */
export const Route = createFileRoute("/_public")({
  component: PublicLayout,
});

function PublicLayout() {
  useTraffic();
  return <Outlet />;
}
