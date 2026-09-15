import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FilePlus } from "lucide-react";
import { z } from "zod";
import { EmptyState } from "#/components/empty-state";
import { ProjectCard } from "#/components/project-card";
import { Button } from "#/components/ui/button";
import { Label } from "#/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "#/components/ui/select";
import { pageTitle } from "#/lib/page-title";
import { PROJECT_STATUS_LABEL } from "#/lib/project-workflow";
import { PROJECT_STATUSES } from "#/lib/vocabularies";
import {
  listMentoredProjects,
  listMyProjects,
} from "#/server/projects-queries";

/** The vocabulary plus the sentinel this filter adds for "no filter". */
const STATUSES = ["all", ...PROJECT_STATUSES] as const;

const searchSchema = z.object({
  status: z.enum(STATUSES).default("all"),
});

export const Route = createFileRoute("/_authed/my/projects")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("My Projects") }] }),
  loaderDeps: ({ search }) => ({ status: search.status }),
  loader: async ({ deps }) => {
    const [{ rows, teamCapacity }, mentoring] = await Promise.all([
      listMyProjects({ data: { status: deps.status } }),
      listMentoredProjects(),
    ]);
    return { rows, teamCapacity, mentoring: mentoring.rows };
  },
  component: MyProjects,
});

function MyProjects() {
  const { mentoring, rows, teamCapacity } = Route.useLoaderData();
  const { status } = Route.useSearch();
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 md:p-8">
      <div className="flex items-center justify-between">
        <h1 className="font-semibold text-2xl">My Projects</h1>
        <Button asChild size="sm">
          <Link to="/projects/new">
            <FilePlus aria-hidden="true" />
            New project
          </Link>
        </Button>
      </div>
      {/* Spans every non-archived project, so it does not move with the status
          filter below. */}
      <p className="mt-1 text-muted-foreground text-sm">
        Expected number of teams (active projects, excluding archived):{" "}
        <span className="font-medium text-foreground tabular-nums">
          {teamCapacity}
        </span>
      </p>

      <div className="mt-4">
        <Label htmlFor="my-filter-status">Status</Label>
        <Select
          onValueChange={(s) =>
            void navigate({
              to: "/my/projects",
              search: { status: s as (typeof STATUSES)[number] },
            })
          }
          value={status}
        >
          <SelectTrigger className="mt-1 w-full md:w-48" id="my-filter-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s === "all" ? "All statuses" : PROJECT_STATUS_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {rows.length === 0 ? (
        <EmptyState>No projects in this view.</EmptyState>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {rows.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
      {/* Hidden when empty, and outside the status filter above: the mentor
          did not propose these, and being named is the whole reason they are
          here (#380). Each card opens the public project page. */}
      {mentoring.length > 0 && (
        <section className="mt-10">
          <h2 className="font-semibold text-xl">Mentoring</h2>
          <p className="mt-1 text-muted-foreground text-sm">
            Projects that list you as the mentor.
          </p>
          <div className="mt-4 flex flex-col gap-3">
            {mentoring.map((p) => (
              <ProjectCard key={p.id} project={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
