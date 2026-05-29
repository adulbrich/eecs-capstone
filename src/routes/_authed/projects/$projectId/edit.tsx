import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { pageTitle } from "#/lib/page-title";
import {
  listProjectCategories,
  setProjectCategories,
} from "#/server/categories";
import { updateProject } from "#/server/projects";
import { getProject } from "#/server/projects-queries";
import { uploadProjectImage } from "#/server/uploads";

export const Route = createFileRoute("/_authed/projects/$projectId/edit")({
  head: () => ({ meta: [{ title: pageTitle("Edit Project") }] }),
  loader: async ({ params }) => {
    const data = await getProject({ data: { id: params.projectId } });
    if (!data.project || !data.canEdit) {
      throw redirect({
        to: "/projects/$projectId",
        params: { projectId: params.projectId },
      });
    }
    const { rows: categoryRows } = await listProjectCategories({
      data: { projectId: params.projectId },
    });
    return { ...data, categoryIds: categoryRows.map((c) => c.id) };
  },
  component: EditProject,
});

function EditProject() {
  const navigate = useNavigate();
  const { project, viewerIsStaff, categoryIds } = Route.useLoaderData();
  if (!project) return null;
  const projectId = project.id as string;
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="text-2xl font-semibold">Edit project</h1>
      <div className="mt-6">
        <ProjectForm
          initial={{
            title: project.title as string,
            description: (project.description as string) ?? "",
            problemStatement: (project.problemStatement as string) ?? "",
            objectives: (project.objectives as string) ?? "",
            minQualifications: (project.minQualifications as string) ?? "",
            prefQualifications: (project.prefQualifications as string) ?? "",
            url: (project.url as string) ?? "",
            contactEmail: (project.contactEmail as string) ?? "",
            contactName: (project.contactName as string) ?? "",
            imageUrl: (project.imageUrl as string) ?? "",
            licenseRestrictions: (project.licenseRestrictions as string) ?? "",
            programId: (project.programId as string) ?? "",
            notes: (project.notes as string) ?? "",
          }}
          initialCategoryIds={categoryIds}
          showNotes={viewerIsStaff}
          showCategories={viewerIsStaff}
          submitLabel="Save"
          enableAiReview
          projectId={projectId}
          onSubmit={async (values, nextCategoryIds, pendingImage) => {
            await updateProject({
              data: {
                id: projectId,
                ...values,
                programId: values.programId || null,
                notes: viewerIsStaff ? values.notes || null : null,
              },
            });
            if (pendingImage) {
              const form = new FormData();
              form.append("projectId", projectId);
              form.append("file", pendingImage);
              await uploadProjectImage({ data: form });
            }
            if (viewerIsStaff) {
              await setProjectCategories({
                data: { projectId, categoryIds: nextCategoryIds },
              });
            }
            navigate({
              to: "/projects/$projectId",
              params: { projectId },
            });
          }}
        />
      </div>
    </div>
  );
}
