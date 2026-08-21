import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BookmarkButton } from "#/components/bookmark-button";
import { CategoryChip } from "#/components/category-chip";
import { Markdown } from "#/components/markdown";
import { OwnerProjectActions } from "#/components/owner-project-actions";
import { ProjectPrivatePanel } from "#/components/project-private-panel";
import { SectionHeading } from "#/components/section-heading";
import { StaffProjectPanel } from "#/components/staff-project-panel";
import { StatusBadge } from "#/components/status-badge";
import { Button } from "#/components/ui/button";
import { isUuid } from "#/lib/is-uuid";
import { pageTitle } from "#/lib/page-title";
import { projectImageSrc } from "#/lib/project-image";
import { listProjectCategories } from "#/server/categories";
import { getProject, listProjectComments } from "#/server/projects-queries";

const PROTOCOL_RE = /^https?:\/\//i;

type GetProjectResult = Awaited<ReturnType<typeof getProject>>;

// Explicit loader return type. On this route `useLoaderData()` / `head`'s
// loaderData resolve to `never` / `undefined` (an unconfirmed TanStack typing
// limitation; an explicit Promise<ProjectDetailData> return alone does not fix
// it, so we also cast at the use sites below). Runtime is unaffected.
interface ProjectDetailData {
  canEdit: GetProjectResult["canEdit"];
  history: GetProjectResult["history"];
  project: NonNullable<GetProjectResult["project"]>;
  projectCategories: Awaited<ReturnType<typeof listProjectCategories>>["rows"];
  viewerIsOwner: GetProjectResult["viewerIsOwner"];
  viewerIsStaff: GetProjectResult["viewerIsStaff"];
}

export const Route = createFileRoute("/projects/$projectId")({
  head: ({ loaderData }) => ({
    meta: [
      {
        title: pageTitle(
          (loaderData as ProjectDetailData | undefined)?.project?.title ??
            "Project"
        ),
      },
    ],
  }),
  loader: async ({ params }): Promise<ProjectDetailData> => {
    // A param that cannot name a project is a 404. Without this the server
    // function's Zod `.uuid()` throws and the page 500s instead.
    if (!isUuid(params.projectId)) {
      throw notFound();
    }
    const data = await getProject({ data: { id: params.projectId } });
    if (!data.project) {
      throw notFound();
    }
    const { rows: projectCategories } = await listProjectCategories({
      data: { projectId: params.projectId },
    });
    return {
      project: data.project,
      history: data.history,
      canEdit: data.canEdit,
      viewerIsStaff: data.viewerIsStaff,
      viewerIsOwner: data.viewerIsOwner,
      projectCategories,
    };
  },
  component: ProjectDetail,
});

type Comment = Parameters<typeof ProjectPrivatePanel>[0]["comments"][number];

function ProjectDetail() {
  const router = useRouter();
  const {
    project,
    history,
    canEdit,
    viewerIsStaff,
    viewerIsOwner,
    projectCategories,
    // TanStack's loaderData inference collapses to never/undefined on this
    // route (see ProjectDetailData above); the loader provably returns it.
  } = Route.useLoaderData() as unknown as ProjectDetailData;
  const [comments, setComments] = useState<Comment[]>([]);
  const projectId = project.id;

  const refreshComments = useCallback(async () => {
    if (!projectId) {
      return;
    }
    try {
      const { rows } = await listProjectComments({
        data: { id: projectId },
      });
      setComments(rows as Comment[]);
    } catch {
      setComments([]);
    }
  }, [projectId]);

  useEffect(() => {
    void refreshComments();
  }, [refreshComments]);

  if (!project) {
    return null;
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-semibold text-2xl">{project.title}</h1>
        <StatusBadge status={project.status} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <BookmarkButton projectId={project.id} />
        {canEdit && (
          <Button asChild size="sm" variant="outline">
            <Link
              params={{ projectId: project.id }}
              to="/projects/$projectId/edit"
            >
              Edit
            </Link>
          </Button>
        )}
      </div>

      {viewerIsOwner && !viewerIsStaff && (
        <OwnerProjectActions
          onChanged={() => {
            void router.invalidate();
          }}
          project={{
            id: project.id,
            status: project.status,
          }}
        />
      )}

      {projectCategories.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {projectCategories.map((c) => (
            <CategoryChip category={c} key={c.id} />
          ))}
        </div>
      )}

      <div className="mt-4 overflow-hidden rounded-lg">
        <img
          alt=""
          className="aspect-[16/9] w-full object-cover"
          src={projectImageSrc(project.imageUrl)}
        />
      </div>

      <Section body={project.description} label="Description" />
      <Section body={project.problemStatement} label="Problem statement" />
      <Section body={project.objectives} label="Objectives" />
      <Section
        body={project.minQualifications}
        label="Minimum qualifications"
      />
      <Section
        body={project.prefQualifications}
        label="Preferred qualifications"
      />
      <ContactSection email={project.contactEmail} name={project.contactName} />
      <AgreementSection
        body={project.licenseRestrictions}
        required={project.requiresNdaIp}
      />
      <UrlSection url={project.url} />

      {(viewerIsStaff || viewerIsOwner) && (
        <ProjectPrivatePanel
          canEdit={canEdit}
          comments={comments}
          history={history}
          notes={project.notes}
          onCommentsChanged={() => {
            void refreshComments();
            void router.invalidate();
          }}
          projectId={project.id}
          teamsSupported={project.teamsSupported}
          viewerIsStaff={viewerIsStaff}
        />
      )}

      {viewerIsStaff && (
        <StaffProjectPanel
          onChanged={() => {
            void router.invalidate();
          }}
          project={{
            id: project.id,
            status: project.status,
            deletedAt: project.deletedAt,
          }}
        />
      )}
    </div>
  );
}

function Section({ label, body }: { label: string; body: string | null }) {
  if (!body) {
    return null;
  }
  return (
    <section className="mt-8">
      <SectionHeading>{label}</SectionHeading>
      <div className="mt-2">
        <Markdown>{body}</Markdown>
      </div>
    </section>
  );
}

/**
 * The flag renders, not just the prose. `requiresNdaIp` is the source of
 * truth and the restrictions text is optional, so keying this off the text
 * alone would leave a student reading nothing on a project that does require
 * an agreement.
 */
function AgreementSection({
  body,
  required,
}: {
  body: string | null;
  required: boolean;
}) {
  if (!required) {
    return null;
  }
  return (
    <section className="mt-8">
      <SectionHeading>Licensing / IP / NDA</SectionHeading>
      <p className="mt-2">This project requires an NDA or IP agreement.</p>
      {body && (
        <div className="mt-2">
          <Markdown>{body}</Markdown>
        </div>
      )}
    </section>
  );
}

function ContactSection({
  name,
  email,
}: {
  name: string | null;
  email: string | null;
}) {
  if (!(name || email)) {
    return null;
  }
  return (
    <section className="mt-8">
      <SectionHeading>Contact</SectionHeading>
      <p className="mt-2">
        {name && <span>{name}</span>}
        {name && email && <span>: </span>}
        {email && (
          <a className="text-brand hover:underline" href={`mailto:${email}`}>
            {email}
          </a>
        )}
      </p>
    </section>
  );
}

function UrlSection({ url }: { url: string | null }) {
  if (!url) {
    return null;
  }
  const href = PROTOCOL_RE.test(url) ? url : `https://${url}`;
  return (
    <section className="mt-8">
      <SectionHeading>URL</SectionHeading>
      <p className="mt-2">
        <a
          className="break-all text-brand hover:underline"
          href={href}
          rel="noopener noreferrer"
          target="_blank"
        >
          {url}
        </a>
      </p>
    </section>
  );
}
