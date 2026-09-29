import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSession } from "#/lib/auth-guards";

export const Route = createFileRoute("/_authed")({
  beforeLoad: async ({ location }) => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({
        to: "/sign-in",
        // The query string too, so a filtered admin list comes back filtered
        // (#606). `href` is path, search and hash, never the origin, and
        // `/sign-in` checks it is a path on this site all the same.
        search: { redirect: location.href },
      });
    }
    return { user: session.user };
  },
  component: AuthedLayout,
});

function AuthedLayout() {
  return <Outlet />;
}
