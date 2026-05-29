import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { type ProjectSummary, programLabel } from "./project-card";
import { StatusBadge } from "./status-badge";

export function ProjectRow({ project }: { project: ProjectSummary }) {
  const src = getPublicUrl(project.imageUrl);
  const meta = [programLabel(project), project.contactName].filter(
    Boolean,
  ) as string[];
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="flex items-stretch gap-3 overflow-hidden rounded-lg border border-border bg-card transition-colors hover:border-primary"
    >
      <div className="relative w-32 shrink-0 self-stretch">
        <ImageOrFallback
          src={src}
          className="absolute inset-0 h-full w-full object-cover"
        />
      </div>
      <div className="min-w-0 flex-1 py-3 pr-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate text-sm font-semibold">{project.title}</h3>
          {project.status !== "published" && (
            <StatusBadge status={project.status} />
          )}
        </div>
        {project.description && (
          <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">
            {project.description}
          </p>
        )}
        {meta.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {meta.join(" · ")}
          </p>
        )}
        {project.updatedAt && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Updated {new Date(project.updatedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </Link>
  );
}
