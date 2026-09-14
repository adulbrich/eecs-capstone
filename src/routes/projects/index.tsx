import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { FilePlus } from "lucide-react";
import { useCallback } from "react";
import { z } from "zod";
import {
  AdminDataTable,
  AdminTableControls,
} from "#/components/admin-data-table";
import { BookmarkSetProvider } from "#/components/bookmark-set";
import { BookmarksButton } from "#/components/bookmarks-button";
import { EmptyState } from "#/components/empty-state";
import { ListingLayout } from "#/components/listing-layout";
import { ProjectCard } from "#/components/project-card";
import {
  PROJECT_TABLE_COLUMNS,
  PROJECT_TABLE_DEFAULT_SORT,
  type ProjectListRow,
} from "#/components/project-table-columns";
import {
  countActiveFilters,
  type FilterCategory,
  type FilterProgram,
  PROJECTS_SEARCH_HINT_ID,
  ProjectsFilters,
  ProjectsSearchBar,
  RecommendationPrompt,
} from "#/components/projects-filters";
import { SearchHint } from "#/components/search-hint";
import { Button } from "#/components/ui/button";
import {
  Pagination,
  PaginationLink,
  PaginationStatus,
} from "#/components/ui/pagination";
import { pageTitle } from "#/lib/page-title";
import { PAGE_SIZE_DEFAULT } from "#/lib/pagination";
import { useAdminTable } from "#/lib/use-admin-table";
import { useSeedViewFromStorage } from "#/lib/use-seed-view";
import { useSignedIn } from "#/lib/use-signed-in";
import type { ViewMode } from "#/lib/view-preference";
import { listCategories } from "#/server/categories";
import { listPrograms } from "#/server/programs";
import { searchProjects } from "#/server/search";

export const searchSchema = z.object({
  q: z.string().default(""),
  categories: z.array(z.string().uuid()).max(20).catch([]).default([]),
  program: z.string().uuid().nullable().default(null),
  archivedOnly: z.boolean().default(false),
  acceptingOnly: z.boolean().default(false),
  studentProposedOnly: z.boolean().default(false),
  seekingMentorOnly: z.boolean().default(false),
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
    acceptingOnly: search.acceptingOnly,
    archivedOnly: search.archivedOnly,
    categories: search.categories,
    order: search.order,
    page: search.page,
    program: search.program,
    q: search.q,
    seekingMentorOnly: search.seekingMentorOnly,
    studentProposedOnly: search.studentProposedOnly,
  }),
  // The two option lists load with the rows rather than in a mount effect,
  // so the filters aside paints complete and the sheet does not grow after
  // it opens. Both are small tables read on every visit anyway.
  loader: async ({ deps }) => {
    const [result, { rows: categories }, { rows: programs }] =
      await Promise.all([
        searchProjects({
          data: {
            query: deps.q,
            categoryIds: deps.categories,
            programId: deps.program,
            archivedOnly: deps.archivedOnly,
            acceptingOnly: deps.acceptingOnly,
            studentProposedOnly: deps.studentProposedOnly,
            seekingMentorOnly: deps.seekingMentorOnly,
            page: deps.page,
            pageSize: PAGE_SIZE_DEFAULT,
            sort: deps.order,
          },
        }),
        listCategories({ data: { domain: "project" } }),
        listPrograms(),
      ]);
    return {
      ...result,
      categories: categories as FilterCategory[],
      programs: programs as FilterProgram[],
    };
  },
  component: ProjectsList,
});

type Search = z.infer<typeof searchSchema>;

/**
 * The table's narrowing state, for `filtered` on the table and its controls:
 * with it, an empty result keeps the headers and the Columns menu and says
 * no project matched; without it, an empty listing says so alone.
 */
function isFiltered(search: Search): boolean {
  return (
    search.q !== "" ||
    search.categories.length > 0 ||
    search.program !== null ||
    search.archivedOnly ||
    search.acceptingOnly ||
    search.studentProposedOnly ||
    search.seekingMentorOnly
  );
}

function ProjectCards({ rows }: { rows: ProjectListRow[] }) {
  if (rows.length === 0) {
    return <EmptyState>No projects matched your search.</EmptyState>;
  }
  return (
    <div className="mt-6 flex max-w-4xl flex-col gap-3">
      {rows.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

function ProjectsList() {
  const { rows, total, page, pageSize, viewer, categories, programs } =
    Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/projects/" });
  const view = search.view ?? "card";
  const seedView = useCallback(
    (next: ViewMode) =>
      navigate({ replace: true, search: (s) => ({ ...s, view: next }) }),
    [navigate]
  );
  useSeedViewFromStorage(search.view, seedView);
  // In the route rather than in a table-only component, because the
  // Columns menu sits in the search row above the table (#367) and needs
  // the same `controlsProps` the table gets. `seedColumns` keeps the column
  // seed effect waiting for table view, so card view's URL stays free of a
  // stored layout it has nothing to show. Sorting is local to the page: the
  // server's `order` decides which rows are here, the column sort decides
  // their order on it, and clicking a header does not send the reader back
  // to page one because the page's rows do not change.
  const { controlsProps, tableProps } = useAdminTable({
    columns: PROJECT_TABLE_COLUMNS,
    defaultSort: PROJECT_TABLE_DEFAULT_SORT,
    navigate,
    search,
    seedColumns: view === "table",
    storageKey: "public-projects",
  });
  const filtered = isFiltered(search);
  const signedIn = useSignedIn();
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const filterState = {
    acceptingOnly: search.acceptingOnly,
    archivedOnly: search.archivedOnly,
    categories: search.categories,
    program: search.program,
    seekingMentorOnly: search.seekingMentorOnly,
    studentProposedOnly: search.studentProposedOnly,
  };
  return (
    <ListingLayout
      activeFilterCount={countActiveFilters(filterState)}
      className="mx-auto max-w-4xl xl:max-w-7xl"
      filters={
        <ProjectsFilters
          allCategories={categories}
          allPrograms={programs}
          {...filterState}
        />
      }
      search={
        <ProjectsSearchBar
          canRecommend={viewer.canRecommend}
          order={search.order}
          q={search.q}
          view={view}
        />
      }
      tableControls={
        view === "table" ? (
          <AdminTableControls
            filtered={filtered}
            rowCount={rows.length}
            {...controlsProps}
          />
        ) : undefined
      }
      title={
        /* flex-wrap and ml-auto: at a phone width the two buttons drop
           under the heading, right-aligned, rather than pushing the page
           wider than the viewport (#280). */
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h1 className="font-semibold text-2xl">Projects</h1>
          <div className="ml-auto flex items-center gap-2">
            {/* The same sign-in gate as BookmarksButton beside it and the
                request button on /inventory: /projects/new is behind _authed,
                and a visitor is sent to sign in rather than shown a door. */}
            {signedIn && (
              <Button asChild size="sm" variant="outline">
                <Link to="/projects/new">
                  <FilePlus aria-hidden="true" />
                  Propose project
                </Link>
              </Button>
            )}
            <BookmarksButton />
          </div>
        </div>
      }
    >
      <SearchHint
        fields="titles, descriptions, objectives and qualifications"
        id={PROJECTS_SEARCH_HINT_ID}
      />
      <RecommendationPrompt
        canRecommend={viewer.canRecommend}
        order={search.order}
        signedIn={viewer.signedIn}
      />
      <BookmarkSetProvider>
        {view === "table" ? (
          <AdminDataTable
            caption="Projects"
            controls="listing"
            data={rows}
            emptyMessage="No projects yet."
            filtered={filtered}
            getRowId={(row) => row.id}
            noMatchMessage="No projects matched your search."
            {...tableProps}
          />
        ) : (
          <ProjectCards rows={rows} />
        )}
      </BookmarkSetProvider>
      <Pagination className="max-w-4xl">
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
        <PaginationStatus
          page={page}
          shown={rows.length}
          total={total}
          totalPages={totalPages}
        />
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
    </ListingLayout>
  );
}
