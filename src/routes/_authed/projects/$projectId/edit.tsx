import {
  createFileRoute,
  notFound,
  redirect,
  useNavigate,
} from "@tanstack/react-router";
import { ProjectForm } from "#/components/project-form";
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
  const projectId = project.id as string;
  return (
    <div className="mx-auto max-w-2xl px-4 py-6 md:p-8">
      <h1 className="font-semibold text-2xl">Edit project</h1>
      <div className="mt-6">
        <ProjectForm
          enableAiReview
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
            proposerEmail: proposer.email,
            teamsSupported: (project.teamsSupported as number) ?? 1,
          }}
          initialCategoryIds={categoryIds}
          onSubmit={async (values, nextCategoryIds, pendingImage) => {
            await updateProject({
              data: {
                id: projectId,
                ...values,
                programId: values.programId || null,
                notes: values.notes || null,
                proposerEmail: viewerIsStaff
                  ? values.proposerEmail || null
                  : undefined,
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
