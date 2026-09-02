import { createFileRoute, Link } from "@tanstack/react-router";
import { EmptyState } from "#/components/empty-state";
import { ProjectCard } from "#/components/project-card";
import { pageTitle } from "#/lib/page-title";
import { listMyBookmarks } from "#/server/bookmarks";

export const Route = createFileRoute("/_authed/my/bookmarks")({
  head: () => ({ meta: [{ title: pageTitle("My Bookmarks") }] }),
  loader: async () => listMyBookmarks(),
  component: MyBookmarks,
});

function MyBookmarks() {
  const { rows } = Route.useLoaderData();
  return (
    <div className="px-4 py-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-semibold text-2xl">My Bookmarks</h1>
      </div>
      {rows.length === 0 ? (
        <EmptyState>
          No bookmarks yet. Browse <Link to="/projects">projects</Link> and
          click the bookmark icon to save one.
        </EmptyState>
      ) : (
        <div className="mx-auto mt-6 flex max-w-4xl flex-col gap-3">
          {rows.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
