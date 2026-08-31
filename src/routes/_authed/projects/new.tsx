import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { pageTitle } from "#/lib/page-title";
import { projectImageUrlToSave } from "#/lib/project-image-save";
import { setProjectCategories } from "#/server/categories";
import { createProject, updateProject } from "#/server/projects";
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
          enableAiReview
          onSubmit={async (values, categoryIds, pendingImage) => {
            const payload = {
              ...values,
              programId: values.programId || null,
              notes: values.notes || null,
            };
            const { id } = await createProject({
              data: {
                ...payload,
                proposerEmail: isStaff
                  ? values.proposerEmail || null
                  : undefined,
              },
            });
            // Create cannot upload first: the key is `projects/<id>/...` and
            // the upload guard loads the project to check the viewer, so there
            // is nothing to upload into until the row exists. Hence a second
            // write here, unlike the edit path, and an edit-log row naming
            // imageUrl on a brand new draft.
            if (pendingImage) {
              const imageUrl = await projectImageUrlToSave({
                currentImageUrl: values.imageUrl,
                pendingImage,
                projectId: id,
                upload: uploadProjectImage,
              });
              await updateProject({
                data: {
                  ...payload,
                  id,
                  imageUrl,
                  // Omitted on purpose: this save is about the image, and an
                  // omitted proposer leaves the one create just set alone. The
                  // form's blank field would unlink it.
                  proposerEmail: undefined,
                },
              });
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
