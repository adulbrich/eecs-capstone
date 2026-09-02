import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { pageTitle } from "#/lib/page-title";

export const Route = createFileRoute("/_authed/projects/new")({
  head: () => ({ meta: [{ title: pageTitle("New Project") }] }),
  component: NewProject,
});

function NewProject() {
  const navigate = useNavigate();
  const ctx = Route.useRouteContext() as {
    user: { role?: string | null };
  };
  const isStaff = ctx.user.role === "admin" || ctx.user.role === "instructor";

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">New project</h1>
      <div className="mt-6">
        <ProjectForm
          enableAiReview
          isStaff={isStaff}
          onSaved={(projectId) => {
            navigate({ to: "/projects/$projectId", params: { projectId } });
          }}
          proposer={{ accountLinked: false, accountName: null, email: "" }}
          showCategories={isStaff}
          showNotes
          showProposer={isStaff}
          submitLabel="Create draft"
        />
      </div>
    </div>
  );
}
