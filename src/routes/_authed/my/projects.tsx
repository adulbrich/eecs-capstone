import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectCard } from "#/components/project-card";
import { listMyProjects } from "#/server/projects-queries";

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
});

export const Route = createFileRoute("/_authed/my/projects")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => {
    return await listMyProjects({ data: { status: deps.status } });
  },
  component: MyProjects,
});

function MyProjects() {
  const { rows } = Route.useLoaderData();
  const { status } = Route.useSearch();
  return (
    <div className="mx-auto max-w-3xl p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">My projects</h1>
        <Link
          to="/projects/new"
          className="bg-black px-3 py-1.5 text-sm text-white"
        >
          New project
        </Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 text-sm">
        {STATUSES.map((s) => (
          <Link
            key={s}
            to="/my/projects"
            search={{ status: s }}
            className={
              s === status
                ? "border-black border-b-2 px-2 py-1"
                : "px-2 py-1 text-neutral-500 hover:underline"
            }
          >
            {s.replace(/_/g, " ")}
          </Link>
        ))}
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
