import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/admin/")({
  component: AdminHome,
});

function AdminHome() {
  return (
    <div className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <ul className="mt-4 space-y-2 text-sm">
        <li>
          <Link to="/admin/projects" className="text-blue-700 hover:underline">
            Projects
          </Link>
        </li>
        <li>
          <Link
            to="/admin/categories"
            className="text-blue-700 hover:underline"
          >
            Categories
          </Link>
        </li>
        <li>
          <Link to="/admin/programs" className="text-blue-700 hover:underline">
            Programs
          </Link>
        </li>
        <li className="text-neutral-400">Users (coming in Spec 4)</li>
      </ul>
    </div>
  );
}
