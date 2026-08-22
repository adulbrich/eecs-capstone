import { Link } from "@tanstack/react-router";
import { projectImageSrc } from "#/lib/project-image";
import { stripMarkdown } from "#/lib/strip-markdown";
import { ImageOrFallback } from "./image-or-fallback";
import { LocalTime } from "./local-time";
import { type ProjectSummary, programLabel } from "./project-card";
import { StatusBadge } from "./status-badge";
import { Card } from "./ui/card";

export function ProjectRow({ project }: { project: ProjectSummary }) {
  const src = projectImageSrc(project.imageUrl);
  const meta = [programLabel(project), project.contactName].filter(
    Boolean
  ) as string[];
  return (
    <Card
      asChild
      className="flex items-center gap-3 overflow-hidden p-3"
      interactive
    >
      <Link params={{ projectId: project.id }} to="/projects/$projectId">
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
              Updated <LocalTime dateOnly value={project.updatedAt} />
            </p>
          )}
        </div>
      </Link>
    </Card>
  );
}
