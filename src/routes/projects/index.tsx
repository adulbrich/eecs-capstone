import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";
import { z } from "zod";
import { AdminDataTable } from "#/components/admin-data-table";
import { BookmarkSetProvider } from "#/components/bookmark-set";
import { BookmarksButton } from "#/components/bookmarks-button";
import { EmptyState } from "#/components/empty-state";
import { ProjectCard } from "#/components/project-card";
import {
  PROJECT_TABLE_COLUMNS,
  PROJECT_TABLE_DEFAULT_SORT,
  type ProjectListRow,
} from "#/components/project-table-columns";
import { ProjectsFilterBar } from "#/components/projects-filter-bar";
import {
  Pagination,
  PaginationLink,
  PaginationStatus,
} from "#/components/ui/pagination";
import { pageTitle } from "#/lib/page-title";
import { useAdminTable } from "#/lib/use-admin-table";
import { useSeedViewFromStorage } from "#/lib/use-seed-view";
import type { ViewMode } from "#/lib/view-preference";
import { searchProjects } from "#/server/search";

const searchSchema = z.object({
  q: z.string().default(""),
  categories: z.array(z.string().uuid()).default([]),
  program: z.string().uuid().nullable().default(null),
  archivedOnly: z.boolean().default(false),
  page: z.number().int().min(1).default(1),
  // The server's ordering, which also decides which twenty rows make up the
  // page. Named `order` because `sort` and `dir` are the table's, below.
  order: z.enum(["relevance", "newest", "recommended"]).default("relevance"),
  // Optional so a param-less visit is detectable; the stored preference then
  // seeds it. Absent from the URL defaults to "card" at render. A value the
  // enum no longer knows (`row`, until 2026-09-02) reads as absent rather than
  // as a router error, so a stale link renders the default.
  view: z.enum(["card", "table"]).optional().catch(undefined),
  // Table mode's column sort and visibility, owned by useAdminTable.
  cols: z.string().optional(),
  dir: z.enum(["asc", "desc"]).optional(),
  sort: z.string().optional(),
});

export const Route = createFileRoute("/projects/")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("Projects") }] }),
  // Only the filter fields: the view mode, the column sort and the column
  // visibility are client state and must not re-run the loader.
  loaderDeps: ({ search }) => ({
    archivedOnly: search.archivedOnly,
    categories: search.categories,
    order: search.order,
    page: search.page,
    program: search.program,
    q: search.q,
  }),
  loader: async ({ deps }) =>
    await searchProjects({
      data: {
        query: deps.q,
        categoryIds: deps.categories,
        programId: deps.program,
        archivedOnly: deps.archivedOnly,
        page: deps.page,
        pageSize: 20,
        sort: deps.order,
      },
    }),
  component: ProjectsList,
});

type Search = z.infer<typeof searchSchema>;

/**
 * Table mode. Its own component so `useAdminTable`, and the column seed
 * effect it runs, only exist while the table is on screen: in card mode a
 * stored column layout has nothing to seed into.
 *
 * Sorting is local to the page. The server's `order` decides which rows are
 * here; the column sort decides their order on it, and clicking a header does
 * not send the reader back to page one because the page's rows do not change.
 */
function ProjectTable({
  rows,
  search,
}: {
  rows: ProjectListRow[];
  search: Search;
}) {
  const navigate = useNavigate({ from: "/projects/" });
  const { tableProps } = useAdminTable({
    columns: PROJECT_TABLE_COLUMNS,
    defaultSort: PROJECT_TABLE_DEFAULT_SORT,
    navigate,
    search,
    storageKey: "public-projects",
  });
  return (
    <AdminDataTable
      caption="Projects"
      data={rows}
      emptyMessage="No projects matched your search."
      getRowId={(row) => row.id}
      {...tableProps}
    />
  );
}

function ProjectCards({ rows }: { rows: ProjectListRow[] }) {
  if (rows.length === 0) {
    return <EmptyState>No projects matched your search.</EmptyState>;
  }
  return (
    <div className="mx-auto mt-6 flex max-w-4xl flex-col gap-3">
      {rows.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

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
        <div className="flex items-center justify-between gap-4">
          <h1 className="font-semibold text-2xl">Projects</h1>
          <BookmarksButton />
        </div>
        <div className="mt-4">
          <ProjectsFilterBar
            archivedOnly={search.archivedOnly}
            categories={search.categories}
            order={search.order}
            program={search.program}
            q={search.q}
            view={view}
          />
        </div>
      </div>
      <BookmarkSetProvider>
        {view === "table" ? (
          <ProjectTable rows={rows} search={search} />
        ) : (
          <ProjectCards rows={rows} />
        )}
      </BookmarkSetProvider>
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
