import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/admin/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <p className="mt-4 text-sm text-neutral-600">
        Admin and instructor tools will land here in Spec 2 (project review,
        category management, user moderation). For now this page exists to
        verify the role gate works.
      </p>
    </div>
  );
}
