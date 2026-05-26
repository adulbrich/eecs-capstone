import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "#/lib/auth-guards";

// Placeholder; full component implemented in task 11.4.
export const Route = createFileRoute("/_authed/admin/inventory/requests")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  component: () => null,
});
