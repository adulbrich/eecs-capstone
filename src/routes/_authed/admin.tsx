import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { getSession } from "#/lib/auth-guards";
import { isStaff } from "#/lib/viewer";

export const Route = createFileRoute("/_authed/admin")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) {
      throw redirect({ to: "/sign-in" });
    }
    if (!isStaff(session.user)) {
      throw redirect({ to: "/" });
    }
    return { user: session.user };
  },
  component: () => <Outlet />,
});
