import { createFileRoute, Link } from "@tanstack/react-router";
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
    <div className="mx-auto max-w-3xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">My bookmarks</h1>
      <div className="mt-6 space-y-3">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No bookmarks yet. Browse <Link to="/projects">projects</Link> and
            click the bookmark icon to save one.
          </p>
        ) : (
          rows.map((p) => <ProjectCard key={p.id} project={p} />)
        )}
      </div>
    </div>
  );
}
