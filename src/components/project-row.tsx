import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { stripMarkdown } from "#/lib/strip-markdown";
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
      className="flex items-center gap-3 overflow-hidden rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary"
      params={{ projectId: project.id }}
      to="/projects/$projectId"
    >
      <ImageOrFallback
        className="aspect-[3/2] w-28 shrink-0 rounded-md object-cover sm:w-40"
        src={src}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-3">
          <h3 className="truncate font-semibold text-sm">{project.title}</h3>
          {project.status !== "published" && (
            <StatusBadge status={project.status} />
          )}
        </div>
        {project.description && (
          <p className="mt-1 line-clamp-3 text-muted-foreground text-sm">
            {stripMarkdown(project.description)}
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
