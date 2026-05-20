import { createFileRoute, Link } from "@tanstack/react-router";
import { z } from "zod";
import { ProjectListItem } from "#/components/project-list-item";
import { ProjectsFilterBar } from "#/components/projects-filter-bar";
import { pageTitle } from "#/lib/page-title";
import { searchProjects } from "#/server/search";

const searchSchema = z.object({
  q: z.string().default(""),
  categories: z.array(z.string().uuid()).default([]),
  program: z.string().uuid().nullable().default(null),
  page: z.number().int().min(1).default(1),
  view: z.enum(["card", "row"]).default("card"),
});

export const Route = createFileRoute("/projects/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Projects") }] }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    return await searchProjects({
      data: {
        query: deps.q,
        categoryIds: deps.categories,
        programId: deps.program,
        page: deps.page,
        pageSize: 20,
      },
    });
  },
  component: ProjectsList,
});

function ProjectsList() {
  const { rows, total, page, pageSize } = Route.useLoaderData();
  const search = Route.useSearch();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Projects</h1>
      <div className="mt-4">
        <ProjectsFilterBar
          q={search.q}
          categories={search.categories}
          program={search.program}
          view={search.view}
        />
      </div>
      <div
        className={
          search.view === "card"
            ? "mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3"
            : "mt-6 space-y-2"
        }
      >
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No projects matched your search.
          </p>
        ) : (
          rows.map((p) => (
            <ProjectListItem key={p.id} project={p} mode={search.view} />
          ))
        )}
      </div>
      <div className="mt-6 flex items-center justify-between text-sm">
        <Link
          to="/projects"
          search={(prev) => ({ ...prev, page: Math.max(1, page - 1) })}
          className={
            page <= 1
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
        >
          Previous
        </Link>
        <span className="text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Link
          to="/projects"
          search={(prev) => ({ ...prev, page: Math.min(totalPages, page + 1) })}
          className={
            page >= totalPages
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
        >
          Next
        </Link>
      </div>
    </div>
  );
}
