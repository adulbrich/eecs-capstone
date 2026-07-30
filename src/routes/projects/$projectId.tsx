import {
  createFileRoute,
  Link,
  notFound,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { BookmarkButton } from "#/components/bookmark-button";
import { CategoryChip } from "#/components/category-chip";
import { CommentThread } from "#/components/comment-thread";
import { Markdown } from "#/components/markdown";
import { OwnerProjectActions } from "#/components/owner-project-actions";
import { SectionHeading } from "#/components/section-heading";
import { StaffProjectPanel } from "#/components/staff-project-panel";
import { StatusBadge } from "#/components/status-badge";
import { StatusTimeline } from "#/components/status-timeline";
import { Button } from "#/components/ui/button";
import { pageTitle } from "#/lib/page-title";
import {
  PRIVATE_NOTES_LABEL,
  PRIVATE_NOTES_PROJECT_HINT,
} from "#/lib/private-notes";
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

type Comment = Parameters<typeof CommentThread>[0]["comments"][number];

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
        <h1 className="font-semibold text-2xl">{project.title as string}</h1>
        <StatusBadge status={project.status as string} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <BookmarkButton projectId={project.id as string} />
        {canEdit && (
          <Button asChild size="sm" variant="outline">
            <Link
              params={{ projectId: project.id as string }}
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
            id: project.id as string,
            status: project.status as string,
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
          src={projectImageSrc(project.imageUrl as string | null)}
        />
      </div>

      <Section
        body={project.description as string | null}
        label="Description"
      />
      <Section
        body={project.problemStatement as string | null}
        label="Problem statement"
      />
      <Section body={project.objectives as string | null} label="Objectives" />
      <Section
        body={project.minQualifications as string | null}
        label="Minimum qualifications"
      />
      <Section
        body={project.prefQualifications as string | null}
        label="Preferred qualifications"
      />
      <ContactSection
        email={project.contactEmail as string | null}
        name={project.contactName as string | null}
      />
      <Section
        body={project.licenseRestrictions as string | null}
        label="License / IP"
      />
      <UrlSection url={project.url as string | null} />

      <PrivateNotesSection
        notes={(project.notes as string | null) ?? null}
        visible={viewerIsStaff || viewerIsOwner}
      />

      {(viewerIsStaff || viewerIsOwner) && (
        <section className="mt-8">
          <SectionHeading>Status history</SectionHeading>
          <div className="mt-3">
            <StatusTimeline rows={history} />
          </div>
        </section>
      )}

      {(viewerIsOwner || viewerIsStaff) && (
        <section className="mt-8">
          <SectionHeading>Comments</SectionHeading>
          <div className="mt-3">
            <CommentThread
              comments={comments}
              onChanged={() => {
                void refreshComments();
                void router.invalidate();
              }}
              projectId={project.id as string}
              viewerIsStaff={viewerIsStaff}
            />
          </div>
        </section>
      )}

      {viewerIsStaff && (
        <StaffProjectPanel
          onChanged={() => {
            void router.invalidate();
          }}
          project={{
            id: project.id as string,
            status: project.status as string,
            deletedAt: (project.deletedAt as Date | null) ?? null,
            teamsSupported: (project.teamsSupported as number) ?? 1,
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
 * Private notes belong to the proposer and staff jointly, so they render on the
 * shared page rather than inside the staff-only panel. The server has already
 * nulled `notes` for everyone else; `visible` only keeps the empty section from
 * rendering for a viewer who could never have content here.
 */
function PrivateNotesSection({
  notes,
  visible,
}: {
  notes: string | null;
  visible: boolean;
}) {
  if (!(visible && notes)) {
    return null;
  }
  return (
    <section className="mt-8">
      <SectionHeading>{PRIVATE_NOTES_LABEL}</SectionHeading>
      <p className="mt-1 text-muted-foreground text-sm">
        {PRIVATE_NOTES_PROJECT_HINT}
      </p>
      <p className="mt-2 whitespace-pre-wrap">{notes}</p>
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
