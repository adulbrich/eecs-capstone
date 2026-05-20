import { createFileRoute, Link } from "@tanstack/react-router";
import { pageTitle } from "#/lib/page-title";

export const Route = createFileRoute("/_authed/admin/")({
  head: () => ({ meta: [{ title: pageTitle("Admin") }] }),
  component: AdminHome,
});

function AdminHome() {
  return (
    <div className="mx-auto max-w-md px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <ul className="mt-4 space-y-2 text-sm">
        <li>
          <Link to="/admin/projects">Projects</Link>
        </li>
        <li>
          <Link to="/admin/categories">Categories</Link>
        </li>
        <li>
          <Link to="/admin/programs">Programs</Link>
        </li>
        <li>
          <Link to="/admin/users">Users</Link>
        </li>
      </ul>
    </div>
  );
}
