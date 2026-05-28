import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { StatusBadge } from "./status-badge";

type ProjectSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  imageUrl?: string | null;
  contactName?: string | null;
  updatedAt?: Date | string | null;
  programCourseId?: string | null;
  programCourseName?: string | null;
};

function programLabel(project: ProjectSummary): string | null {
  const parts = [project.programCourseId, project.programCourseName].filter(
    Boolean,
  ) as string[];
  return parts.length > 0 ? parts.join(" ") : null;
}

function ProjectMeta({ project }: { project: ProjectSummary }) {
  const meta = [programLabel(project), project.contactName].filter(
    Boolean,
  ) as string[];
  return (
    <div className="mt-2">
      {meta.length > 0 && (
        <p className="text-xs text-muted-foreground">{meta.join(" · ")}</p>
      )}
      {project.updatedAt && (
        <p className="mt-0.5 text-xs text-muted-foreground">
          Updated {new Date(project.updatedAt).toLocaleDateString()}
        </p>
      )}
    </div>
  );
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const src = getPublicUrl(project.imageUrl);
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="flex flex-col overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary"
    >
      <ImageOrFallback
        src={src}
        className="aspect-[16/9] w-full object-cover"
      />
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="font-semibold leading-tight">{project.title}</h3>
          {project.status !== "published" && (
            <StatusBadge status={project.status} />
          )}
        </div>
        {project.description && (
          <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
        <ProjectMeta project={project} />
      </div>
    </Link>
  );
}

export { programLabel, ProjectMeta };
export type { ProjectSummary };
