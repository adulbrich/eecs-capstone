import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { pageTitle } from "#/lib/page-title";
import { isStaff } from "#/lib/viewer";

export const Route = createFileRoute("/_authed/projects/new")({
  head: () => ({ meta: [{ title: pageTitle("New Project") }] }),
  component: NewProject,
});

function NewProject() {
  const navigate = useNavigate();
  const ctx = Route.useRouteContext() as {
    user: { id: string; role?: string | null };
  };
  const viewerIsStaff = isStaff(ctx.user);

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">New project</h1>
      <div className="mt-6">
        <ProjectForm
          enableAiReview
          isStaff={viewerIsStaff}
          onSaved={(projectId) => {
            navigate({ to: "/projects/$projectId", params: { projectId } });
          }}
          proposer={{ accountLinked: false, accountName: null, email: "" }}
          showCategories={viewerIsStaff}
          showNotes
          showProposer={viewerIsStaff}
          submitLabel="Create draft"
        />
      </div>
    </div>
  );
}
