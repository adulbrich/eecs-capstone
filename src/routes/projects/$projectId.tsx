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
import { OwnerProjectActions } from "#/components/owner-project-actions";
import { StaffProjectPanel } from "#/components/staff-project-panel";
import { StatusBadge } from "#/components/status-badge";
import { StatusTimeline } from "#/components/status-timeline";
import { Button } from "#/components/ui/button";
import { pageTitle } from "#/lib/page-title";
import { getPublicUrl } from "#/lib/storage";
import { listProjectCategories } from "#/server/categories";
import { getProject, listProjectComments } from "#/server/projects-queries";

export const Route = createFileRoute("/projects/$projectId")({
  head: ({ loaderData }) => ({
    meta: [
      {
        title: pageTitle(
          (loaderData?.project?.title as string | undefined) ?? "Project",
        ),
      },
    ],
  }),
  loader: async ({ params }) => {
    const data = await getProject({ data: { id: params.projectId } });
    if (!data.project) throw notFound();
    const { rows: projectCategories } = await listProjectCategories({
      data: { projectId: params.projectId },
    });
    return { ...data, projectCategories };
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
  } = Route.useLoaderData();
  const [comments, setComments] = useState<Comment[]>([]);
  const projectId = project?.id as string | undefined;

  const refreshComments = useCallback(async () => {
    if (!projectId) return;
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

  if (!project) return null;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:p-8">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{project.title as string}</h1>
        <StatusBadge status={project.status as string} />
      </div>
      <div className="mt-3 flex items-center gap-2">
        <BookmarkButton projectId={project.id as string} />
        {canEdit && (
          <Button asChild variant="outline" size="sm">
            <Link
              to="/projects/$projectId/edit"
              params={{ projectId: project.id as string }}
            >
              Edit
            </Link>
          </Button>
        )}
      </div>

      {viewerIsOwner && !viewerIsStaff && (
        <OwnerProjectActions
          project={{
            id: project.id as string,
            status: project.status as string,
          }}
          onChanged={() => {
            void router.invalidate();
          }}
        />
      )}

      {projectCategories.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {projectCategories.map((c) => (
            <CategoryChip key={c.id} category={c} />
          ))}
        </div>
      )}

      {(() => {
        const heroUrl = getPublicUrl(project.imageUrl as string | null);
        if (!heroUrl) return null;
        return (
          <div className="mt-4 overflow-hidden rounded-lg">
            <img
              src={heroUrl}
              alt=""
              className="aspect-[16/9] w-full object-cover"
            />
          </div>
        );
      })()}

      <Section
        label="Description"
        body={project.description as string | null}
      />
      <Section
        label="Problem statement"
        body={project.problemStatement as string | null}
      />
      <Section label="Objectives" body={project.objectives as string | null} />
      <Section
        label="Minimum qualifications"
        body={project.minQualifications as string | null}
      />
      <Section
        label="Preferred qualifications"
        body={project.prefQualifications as string | null}
      />
      <ContactSection
        name={project.contactName as string | null}
        email={project.contactEmail as string | null}
      />
      <Section
        label="License / IP"
        body={project.licenseRestrictions as string | null}
      />
      <UrlSection url={project.url as string | null} />

      <section className="mt-8">
        <h2 className="font-semibold text-lg">Status history</h2>
        <div className="mt-3">
          <StatusTimeline rows={history} />
        </div>
      </section>

      {(viewerIsOwner || viewerIsStaff) && (
        <section className="mt-8">
          <h2 className="font-semibold text-lg">Comments</h2>
          <div className="mt-3">
            <CommentThread
              projectId={project.id as string}
              comments={comments}
              viewerIsStaff={viewerIsStaff}
              onChanged={() => {
                void refreshComments();
                void router.invalidate();
              }}
            />
          </div>
        </section>
      )}

      {viewerIsStaff && (
        <StaffProjectPanel
          project={{
            id: project.id as string,
            status: project.status as string,
            deletedAt: (project.deletedAt as Date | null) ?? null,
            notes: (project.notes as string | null) ?? null,
          }}
          onChanged={() => {
            void router.invalidate();
          }}
        />
      )}
    </div>
  );
}

function Section({ label, body }: { label: string; body: string | null }) {
  if (!body) return null;
  return (
    <section className="mt-6">
      <h2 className="font-medium text-sm text-muted-foreground">{label}</h2>
      <p className="mt-1 whitespace-pre-wrap">{body}</p>
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
  if (!name && !email) return null;
  return (
    <section className="mt-6">
      <h2 className="font-medium text-sm text-muted-foreground">Contact</h2>
      <p className="mt-1">
        {name && <span>{name}</span>}
        {name && email && <span>: </span>}
        {email && (
          <a href={`mailto:${email}`} className="text-brand hover:underline">
            {email}
          </a>
        )}
      </p>
    </section>
  );
}

function UrlSection({ url }: { url: string | null }) {
  if (!url) return null;
  const href = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return (
    <section className="mt-6">
      <h2 className="font-medium text-sm text-muted-foreground">URL</h2>
      <p className="mt-1">
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="break-all text-brand hover:underline"
        >
          {url}
        </a>
      </p>
    </section>
  );
}
