import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectRow } from "#/components/project-row";
import { getSession } from "#/lib/auth-guards";
import { pageTitle } from "#/lib/page-title";
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
  head: () => ({ meta: [{ title: pageTitle("Projects") }] }),
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
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Admin: projects</h1>
      <div className="mt-4 flex items-end justify-between">
        <div className="flex border-b border-border text-sm">
          {STATUSES.map((s) => (
            <Link
              key={s}
              to="/admin/projects"
              search={(prev) => ({ ...prev, status: s })}
              className={
                s === status
                  ? "-mb-px border-b-2 px-3 py-1.5 font-medium"
                  : "px-3 py-1.5 text-muted-foreground hover:text-foreground"
              }
              style={
                s === status
                  ? { borderBottomColor: "var(--brand-primary)" }
                  : undefined
              }
            >
              {s.replace(/_/g, " ")}
            </Link>
          ))}
        </div>
        <Link
          to="/admin/projects"
          search={(prev) => ({
            ...prev,
            includeSoftDeleted: !includeSoftDeleted,
          })}
          className="mb-2 text-xs text-muted-foreground hover:text-foreground"
        >
          {includeSoftDeleted ? "Hide soft-deleted" : "Show soft-deleted"}
        </Link>
      </div>
      <div className="mt-4 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects in this view.
          </p>
        ) : (
          rows.map((p) => <ProjectRow key={p.id} project={p} />)
        )}
      </div>
    </div>
  );
}
