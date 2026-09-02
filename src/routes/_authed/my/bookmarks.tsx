import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { z } from "zod";
import { AdminDataTable } from "#/components/admin-data-table";
import {
  BOOKMARK_TABLE_COLUMNS,
  BOOKMARK_TABLE_DEFAULT_SORT,
} from "#/components/bookmark-table-columns";
import { EmptyState } from "#/components/empty-state";
import { pageTitle } from "#/lib/page-title";
import { useAdminTable } from "#/lib/use-admin-table";
import { listMyBookmarks } from "#/server/bookmarks";

// Only the table's own sort state. No view toggle and no column picker (so no
// `cols` either): a shortlist is small by construction and has one sensible
// presentation.
const searchSchema = z.object({
  dir: z.enum(["asc", "desc"]).optional(),
  sort: z.string().optional(),
});

export const Route = createFileRoute("/_authed/my/bookmarks")({
  validateSearch: searchSchema,
  head: () => ({ meta: [{ title: pageTitle("My Bookmarks") }] }),
  loader: async () => listMyBookmarks(),
  component: MyBookmarks,
});

function unavailableLine(count: number): string {
  return count === 1
    ? "1 saved project is not currently available."
    : `${count} saved projects are not currently available.`;
}

function MyBookmarks() {
  const { rows, unavailableCount } = Route.useLoaderData();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/my/bookmarks" });
  const { tableProps } = useAdminTable({
    columns: BOOKMARK_TABLE_COLUMNS,
    defaultSort: BOOKMARK_TABLE_DEFAULT_SORT,
    navigate,
    search,
    storageKey: "my-bookmarks",
  });
  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-semibold text-2xl">My Bookmarks</h1>
        {rows.length === 0 && (
          <EmptyState>
            {unavailableCount > 0 ? (
              // The whole shortlist dropped out. "No bookmarks yet" here
              // would contradict the count and read as lost bookmarks.
              <>
                {unavailableLine(unavailableCount)} Save another from the{" "}
                <Link to="/projects">projects list</Link> or a project's page.
              </>
            ) : (
              <>
                No bookmarks yet. Save a project from the{" "}
                <Link to="/projects">projects list</Link> or its page and it
                shows up here.
              </>
            )}
          </EmptyState>
        )}
      </div>
      {/* Full width below the bounded title, the way /projects and the admin
          tables run their tables. */}
      {rows.length > 0 && (
        <>
          <AdminDataTable
            caption="My bookmarks"
            data={rows}
            emptyMessage="No bookmarks yet."
            getRowId={(row) => row.id}
            {...tableProps}
          />
          {/*
            One quiet line, no titles: a list that silently got shorter reads
            as a lost bookmark, and the count reveals nothing the viewer did
            not save themselves. The row survives, so a republished project
            returns.
          */}
          {unavailableCount > 0 && (
            <p className="mt-3 text-muted-foreground text-sm">
              {unavailableLine(unavailableCount)}
            </p>
          )}
        </>
      )}
    </div>
  );
}
