import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback, type ProjectSummary } from "./project-card";
import { StatusBadge } from "./status-badge";

export function ProjectRow({ project }: { project: ProjectSummary }) {
  const src = getPublicUrl(project.imageUrl);
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="flex items-stretch gap-3 rounded border border-[var(--line)] hover:border-[var(--brand-primary)]"
      style={{
        background: "var(--surface-raised)",
        transition: "border-color 180ms ease",
      }}
    >
      <ImageOrFallback
        src={src}
        className="h-20 w-28 flex-shrink-0 object-cover"
      />
      <div className="min-w-0 flex-1 p-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="truncate font-medium">{project.title}</h3>
          <StatusBadge status={project.status} />
        </div>
        {project.description && (
          <p
            className="mt-1 line-clamp-1 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            {project.description}
          </p>
        )}
        {project.publishedAt && (
          <p className="mt-1 text-xs" style={{ color: "var(--text-tertiary)" }}>
            {new Date(project.publishedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </Link>
  );
}
