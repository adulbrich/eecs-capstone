import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { pageTitle } from "#/lib/page-title";
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
            const { id, proposerEmail } = await createProject({
              data: {
                ...values,
                programId: values.programId || null,
                notes: values.notes || null,
                proposerEmail: isStaff
                  ? values.proposerEmail || null
                  : undefined,
              },
            });
            // Create cannot upload first: the storage key is
            // `projects/<id>/...` and the upload guard needs a project row to
            // check the viewer against, so there is nothing to upload into
            // until the project exists. That costs a second write here, unlike
            // the edit path. It is honest rather than free: the image lands in
            // the edit log as a change on a brand new draft.
            if (pendingImage) {
              const form = new FormData();
              form.append("projectId", id);
              form.append("file", pendingImage);
              const { key } = await uploadProjectImage({ data: form });
              await updateProject({
                data: {
                  id,
                  ...values,
                  imageUrl: key,
                  programId: values.programId || null,
                  notes: values.notes || null,
                  // The address create actually resolved, not the blank field
                  // the form sent. Blank means "default to the creator" on
                  // create and "unlink the proposer" on update, so echoing it
                  // back would drop the link this project just got.
                  proposerEmail: isStaff ? proposerEmail : undefined,
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
