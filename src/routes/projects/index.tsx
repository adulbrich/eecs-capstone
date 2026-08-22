import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import { EmptyState } from "#/components/empty-state";
import { ProjectListItem } from "#/components/project-list-item";
import { ProjectsFilterBar } from "#/components/projects-filter-bar";
import {
  Pagination,
  PaginationLink,
  PaginationStatus,
} from "#/components/ui/pagination";
import { pageTitle } from "#/lib/page-title";
import { useSeedViewFromStorage } from "#/lib/use-seed-view";
import type { ViewMode } from "#/lib/view-preference";
import { searchProjects } from "#/server/search";

const searchSchema = z.object({
  q: z.string().default(""),
  categories: z.array(z.string().uuid()).default([]),
  program: z.string().uuid().nullable().default(null),
  archivedOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  sort: z.enum(["relevance", "newest", "recommended"]).default("relevance"),
  // Optional so a param-less visit is detectable; the stored preference then
  // seeds it. Absent from the URL defaults to "card" at render.
  view: z.enum(["card", "row"]).optional(),
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
        sort: deps.sort,
      },
    }),
  component: ProjectsList,
});

function ProjectsList() {
  const { rows, total, page, pageSize } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/projects/" });
  const view = search.view ?? "card";
  const seedView = useCallback(
    (next: ViewMode) =>
      navigate({ replace: true, search: (s) => ({ ...s, view: next }) }),
    [navigate]
  );
  useSeedViewFromStorage(search.view, seedView);
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
            sort={search.sort}
            view={view}
          />
        </div>
      </div>
      {rows.length === 0 ? (
        <EmptyState>No projects matched your search.</EmptyState>
      ) : (
        <div
          className={
            view === "card"
              ? "mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5"
              : "mx-auto mt-6 flex max-w-4xl flex-col gap-3"
          }
        >
          {rows.map((p) => (
            <ProjectListItem key={p.id} mode={view} project={p} />
          ))}
        </div>
      )}
      <Pagination className="mx-auto max-w-4xl">
        {page <= 1 ? (
          <PaginationLink disabled>Previous</PaginationLink>
        ) : (
          <PaginationLink asChild>
            <Link
              from="/projects/"
              search={(prev) => ({ ...prev, page: page - 1 })}
              to="/projects"
            >
              Previous
            </Link>
          </PaginationLink>
        )}
        <PaginationStatus page={page} totalPages={totalPages} />
        {page >= totalPages ? (
          <PaginationLink disabled>Next</PaginationLink>
        ) : (
          <PaginationLink asChild>
            <Link
              from="/projects/"
              search={(prev) => ({ ...prev, page: page + 1 })}
              to="/projects"
            >
              Next
            </Link>
          </PaginationLink>
        )}
      </Pagination>
    </div>
  );
}
