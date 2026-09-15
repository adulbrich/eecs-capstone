import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { ProjectForm } from "#/components/project-form";
import { pageTitle } from "#/lib/page-title";
import { STAFF_CREATE_PROJECT_NOTE } from "#/lib/private-notes";
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
      {viewerIsStaff && (
        <p className="mt-2 text-muted-foreground text-sm">
          {STAFF_CREATE_PROJECT_NOTE}
        </p>
      )}
      <div className="mt-6">
        <ProjectForm
          enableAiReview
          onSaved={(projectId) => {
            // The page that would have carried an inline confirmation is
            // gone by the time it would render, so a form that navigates
            // says so in a toast (UI-CONVENTIONS, "Mutations and feedback").
            toast.success("Draft created.");
            navigate({ to: "/projects/$projectId", params: { projectId } });
          }}
          showNotes
          submitLabel="Create draft"
        />
      </div>
    </div>
  );
}
