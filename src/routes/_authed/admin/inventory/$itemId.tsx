import { createFileRoute, redirect } from "@tanstack/react-router";
import { getSession } from "#/lib/auth-guards";

// Placeholder; real component lives below once history fn is added.
export const Route = createFileRoute("/_authed/admin/inventory/$itemId")({
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  component: () => null,
});
