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
    <div className="px-4 py-6 md:p-8">
      <div className="mx-auto max-w-4xl">
        <h1 className="font-semibold text-2xl">My bookmarks</h1>
      </div>
      {rows.length === 0 ? (
        <p className="mx-auto mt-6 max-w-4xl text-muted-foreground text-sm">
          No bookmarks yet. Browse <Link to="/projects">projects</Link> and
          click the bookmark icon to save one.
        </p>
      ) : (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {rows.map((p) => (
            <ProjectCard key={p.id} project={p} />
          ))}
        </div>
      )}
    </div>
  );
}
