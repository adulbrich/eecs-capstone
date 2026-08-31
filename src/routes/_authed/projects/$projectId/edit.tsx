import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
import { imageUrlToSave } from "#/lib/image-save";
import { isUuid } from "#/lib/is-uuid";
import { pageTitle } from "#/lib/page-title";
import {
  listProjectCategories,
  setProjectCategories,
} from "#/server/categories";
import { updateProject } from "#/server/projects";
import { getProject, getProposerForEdit } from "#/server/projects-queries";
import { uploadProjectImage } from "#/server/uploads";

export const Route = createFileRoute("/_authed/projects/$projectId/edit")({
  head: () => ({ meta: [{ title: pageTitle("Edit Project") }] }),
  loader: async ({ params }) => {
    // 404 rather than the redirect below: a malformed id has no project detail
    // page to send the user to, so redirecting would just bounce them into the
    // same 500 one route over.
    if (!isUuid(params.projectId)) {
      throw notFound();
    }
    const data = await getProject({ data: { id: params.projectId } });
    if (!(data.project && data.canEdit)) {
      throw redirect({
        to: "/projects/$projectId",
        params: { projectId: params.projectId },
      });
    }
    const { rows: categoryRows } = await listProjectCategories({
      data: { projectId: params.projectId },
    });
    const proposer = data.viewerIsStaff
      ? await getProposerForEdit({ data: { projectId: params.projectId } })
      : { accountLinked: false, accountName: null, email: "" };
    return {
      ...data,
      categoryIds: categoryRows.map((c) => c.id),
      proposer,
    };
  },
  component: EditProject,
});

function EditProject() {
  const navigate = useNavigate();
  const { project, viewerIsStaff, categoryIds, proposer } =
    Route.useLoaderData();
  if (!project) {
    return null;
  }
  const projectId = project.id;
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">Edit project</h1>
      <div className="mt-6">
        <ProjectForm
          enableAiReview
          initial={{
            title: project.title,
            description: project.description ?? "",
            problemStatement: project.problemStatement ?? "",
            objectives: project.objectives ?? "",
            minQualifications: project.minQualifications ?? "",
            prefQualifications: project.prefQualifications ?? "",
            url: project.url ?? "",
            contactEmail: project.contactEmail ?? "",
            contactName: project.contactName ?? "",
            imageUrl: project.imageUrl ?? "",
            licenseRestrictions: project.licenseRestrictions ?? "",
            requiresNdaIp: project.requiresNdaIp,
            // Absent for a viewer who may not see it, but only staff and the
            // proposer reach this page, and both of those get the field.
            isSponsored: project.isSponsored ?? false,
            programId: project.programId ?? "",
            notes: project.notes ?? "",
            proposerEmail: proposer.email,
            teamsSupported: project.teamsSupported ?? 1,
          }}
          initialCategoryIds={categoryIds}
          onSubmit={async (values, nextCategoryIds, pendingImage) => {
            // Before the row write, never after: see image-save.ts.
            const imageUrl = await imageUrlToSave({
              currentImageUrl: values.imageUrl,
              owner: { projectId },
              pendingImage,
              upload: uploadProjectImage,
            });
            await updateProject({
              data: {
                id: projectId,
                ...values,
                imageUrl,
                programId: values.programId || null,
                notes: values.notes || null,
                proposerEmail: viewerIsStaff
                  ? values.proposerEmail || null
                  : undefined,
              },
            });
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
          projectId={projectId}
          proposer={proposer}
          showCategories={viewerIsStaff}
          showNotes
          showProposer={viewerIsStaff}
          submitLabel="Save"
        />
      </div>
    </div>
  );
}
