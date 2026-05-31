import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { type ProjectSummary, programLabel } from "./project-card";
import { StatusBadge } from "./status-badge";

export function ProjectRow({ project }: { project: ProjectSummary }) {
  const src = getPublicUrl(project.imageUrl);
  const meta = [programLabel(project), project.contactName].filter(
    Boolean
  ) as string[];
  return (
    <Link
      className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary"
      params={{ projectId: project.id }}
      to="/projects/$projectId"
    >
      <div className="relative w-32 shrink-0 self-stretch">
        <ImageOrFallback
          className="absolute inset-0 h-full w-full object-cover"
          src={src}
        />
      </div>
      <div className="min-w-0 flex-1 py-3 pr-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate font-semibold text-sm">{project.title}</h3>
          {project.status !== "published" && (
            <StatusBadge status={project.status} />
          )}
        </div>
        {project.description && (
          <p className="mt-1 line-clamp-3 text-muted-foreground text-sm">
            {project.description}
          </p>
        )}
        {meta.length > 0 && (
          <p className="mt-1 text-muted-foreground text-xs">
            {meta.join(" · ")}
          </p>
        )}
        {project.updatedAt && (
          <p className="mt-0.5 text-muted-foreground text-xs">
            Updated {new Date(project.updatedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </Link>
  );
}
