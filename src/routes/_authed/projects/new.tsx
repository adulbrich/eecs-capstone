import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { createProject } from "#/server/projects";

export const Route = createFileRoute("/_authed/projects/new")({
  component: NewProject,
});

function NewProject() {
  const navigate = useNavigate();
  const ctx = Route.useRouteContext() as {
    user: { role?: string | null };
  };
  const isStaff = ctx.user.role === "admin" || ctx.user.role === "instructor";
  return (
    <div className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold">New project</h1>
      <div className="mt-6">
        <ProjectForm
          showNotes={isStaff}
          submitLabel="Create draft"
          onSubmit={async (values) => {
            const { id } = await createProject({
              data: {
                ...values,
                programId: values.programId || null,
                notes: isStaff ? values.notes || null : null,
              },
            });
            navigate({
              to: "/projects/$projectId",
              params: { projectId: id },
            });
          }}
        />
      </div>
    </div>
  );
}
