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
  archivedOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  view: z.enum(["card", "row"]).default("card"),
});

export const Route = createFileRoute("/projects/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Projects") }] }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) =>
    await searchProjects({
      data: {
        query: deps.q,
        categoryIds: deps.categories,
        programId: deps.program,
        archivedOnly: deps.archivedOnly,
        page: deps.page,
        pageSize: 20,
      },
    }),
  component: ProjectsList,
});

function ProjectsList() {
  const { rows, total, page, pageSize } = Route.useLoaderData();
  const search = Route.useSearch();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-semibold text-2xl">Projects</h1>
        <div className="mt-4">
          <ProjectsFilterBar
            archivedOnly={search.archivedOnly}
            categories={search.categories}
            program={search.program}
            q={search.q}
            view={search.view}
          />
        </div>
      </div>
      <div
        className={
          search.view === "card"
            ? "mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
            : "mx-auto mt-6 flex max-w-4xl flex-col gap-3"
        }
      >
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No projects matched your search.
          </p>
        ) : (
          rows.map((p) => (
            <ProjectListItem key={p.id} mode={search.view} project={p} />
          ))
        )}
      </div>
      <div className="mx-auto mt-6 flex max-w-4xl items-center justify-between text-sm">
        <Link
          className={
            page <= 1
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
          search={(prev) => ({ ...prev, page: Math.max(1, page - 1) })}
          to="/projects"
        >
          Previous
        </Link>
        <span className="text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Link
          className={
            page >= totalPages
              ? "pointer-events-none text-muted-foreground/40"
              : "hover:underline"
          }
          search={(prev) => ({ ...prev, page: Math.min(totalPages, page + 1) })}
          to="/projects"
        >
          Next
        </Link>
      </div>
    </div>
  );
}
