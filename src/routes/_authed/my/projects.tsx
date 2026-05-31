import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectRow } from "#/components/project-row";
import { Button } from "#/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { pageTitle } from "#/lib/page-title";
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
  head: () => ({ meta: [{ title: pageTitle("My Projects") }] }),
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) =>
    await listMyProjects({ data: { status: deps.status } }),
  component: MyProjects,
});

function MyProjects() {
  const { rows } = Route.useLoaderData();
  const { status } = Route.useSearch();
  const navigate = useNavigate();

  const label = (s: string) => s.replace(/_/g, " ");

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl">My Projects</h1>
        <Button asChild size="sm">
          <Link to="/projects/new">New project</Link>
        </Button>
      </div>

      {/* Mobile: Select */}
      <div className="mt-4 md:hidden">
        <Select
          onValueChange={(s) =>
            void navigate({
              to: "/my/projects",
              search: { status: s as (typeof STATUSES)[number] },
            })
          }
          value={status}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {label(s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Desktop: tab strip */}
      <div className="mt-4 hidden border-border border-b text-sm md:flex">
        {STATUSES.map((s) => (
          <Link
            className={
              s === status
                ? "-mb-px border-b-2 px-3 py-1.5 font-medium"
                : "px-3 py-1.5 text-muted-foreground hover:text-foreground"
            }
            key={s}
            search={{ status: s }}
            style={
              s === status
                ? { borderBottomColor: "var(--brand-primary)" }
                : undefined
            }
            to="/my/projects"
          >
            {label(s)}
          </Link>
        ))}
      </div>
      <div className="mt-6 flex flex-col gap-3">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No projects in this view.
          </p>
        ) : (
          rows.map((p) => <ProjectRow key={p.id} project={p} />)
        )}
      </div>
    </div>
  );
}
