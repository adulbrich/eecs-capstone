import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { pageTitle } from "#/lib/page-title";
import { setProjectCategories } from "#/server/categories";
import { createProject } from "#/server/projects";
import { uploadProjectImage } from "#/server/uploads";

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
          onSubmit={async (values, categoryIds, pendingImage) => {
            const { id } = await createProject({
              data: {
                ...values,
                programId: values.programId || null,
                notes: isStaff ? values.notes || null : null,
              },
            });
            if (pendingImage) {
              const form = new FormData();
              form.append("projectId", id);
              form.append("file", pendingImage);
              await uploadProjectImage({ data: form });
            }
            if (isStaff && categoryIds.length > 0) {
              await setProjectCategories({
                data: { projectId: id, categoryIds },
              });
            }
            navigate({
              to: "/projects/$projectId",
              params: { projectId: id },
            });
          }}
          showCategories={isStaff}
          showNotes={isStaff}
          submitLabel="Create draft"
        />
      </div>
    </div>
  );
}
