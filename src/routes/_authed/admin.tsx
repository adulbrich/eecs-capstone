import { createFileRoute, Outlet } from "@tanstack/react-router";
import { requireStaff } from "#/lib/access-denied";

// `_authed` has already read the session and redirected a signed-out viewer,
// so this layer and every page below it ask about `context.user` rather than
// reading the session again: one read per load, not one per layer (#633).
// The guards stay navigation UX; each server function enforces its own
// access level (ADR-0003).
export const Route = createFileRoute("/_authed/admin")({
  beforeLoad: ({ context }) => {
    requireStaff(context.user);
  },
  component: () => <Outlet />,
});
