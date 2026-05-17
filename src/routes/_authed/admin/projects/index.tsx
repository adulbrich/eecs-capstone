import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectCard } from "#/components/project-card";
import { getSession } from "#/lib/auth-guards";
import { listAdminProjects } from "#/server/projects-queries";

const STATUSES = [
  "all",
  "draft",
  "submitted",
  "approved",
  "changes_requested",
  "published",
  "archived",
] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).default("all"),
  includeSoftDeleted: z.boolean().default(false),
});

export const Route = createFileRoute("/_authed/admin/projects/")({
  validateSearch: searchSchema,
  beforeLoad: async () => {
    const session = await getSession();
    if (!session?.user) throw redirect({ to: "/sign-in" });
    if (!["admin", "instructor"].includes(session.user.role ?? "")) {
      throw redirect({ to: "/" });
    }
  },
  loaderDeps: ({ search }) => ({
    status: search.status,
    includeSoftDeleted: search.includeSoftDeleted,
  }),
  loader: async ({ deps }) => {
    return await listAdminProjects({
      data: {
        status: deps.status,
        includeSoftDeleted: deps.includeSoftDeleted,
      },
    });
  },
  component: AdminProjects,
});

function AdminProjects() {
  const { rows } = Route.useLoaderData();
  const { status, includeSoftDeleted } = Route.useSearch();
  return (
    <div className="mx-auto max-w-4xl p-8">
      <h1 className="text-2xl font-semibold">Admin: projects</h1>
      <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            to="/admin/projects"
            search={(prev) => ({ ...prev, status: s })}
            className={
              s === status
                ? "border-black border-b-2 px-2 py-1"
                : "px-2 py-1 text-neutral-500 hover:underline"
            }
          >
            {s.replace(/_/g, " ")}
          </Link>
        ))}
        <Link
          to="/admin/projects"
          search={(prev) => ({
            ...prev,
            includeSoftDeleted: !includeSoftDeleted,
          })}
          className="ml-4 border px-2 py-1"
        >
          {includeSoftDeleted ? "Hide soft-deleted" : "Show soft-deleted"}
        </Link>
      </div>
      <div className="mt-4 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-neutral-500">No projects in this view.</p>
        ) : (
          rows.map((p) => <ProjectCard key={p.id} project={p} />)
        )}
      </div>
    </div>
  );
}
