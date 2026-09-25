import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { isStaff } from "#/lib/viewer";

// `_authed` has already read the session and redirected a signed-out viewer,
// so this layer and every page below it ask about `context.user` rather than
// reading the session again: one read per navigation, not one per layer
// (#633). The guards stay navigation UX; each server function enforces its
// own access level (ADR-0003).
export const Route = createFileRoute("/_authed/admin")({
  beforeLoad: ({ context }) => {
    if (!isStaff(context.user)) {
      throw redirect({ to: "/" });
    }
  },
  component: () => <Outlet />,
});
