import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
import { ImageOrFallback } from "./image-or-fallback";
import { StatusBadge } from "./status-badge";

type ProjectSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  publishedAt: Date | string | null;
  imageUrl?: string | null;
};

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const src = getPublicUrl(project.imageUrl);
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="block overflow-hidden rounded border border-[var(--line)] hover:border-[var(--brand-primary)] hover:shadow-sm"
      style={{
        background: "var(--surface-raised)",
        transition: "border-color 180ms ease, box-shadow 180ms ease",
      }}
    >
      <ImageOrFallback
        src={src}
        className="aspect-[16/9] w-full object-cover"
      />
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <h3
            className="font-semibold"
            style={{ color: "var(--text-primary)" }}
          >
            {project.title}
          </h3>
          <StatusBadge status={project.status} />
        </div>
        {project.description && (
          <p
            className="mt-2 line-clamp-2 text-sm"
            style={{ color: "var(--text-secondary)" }}
          >
            {project.description}
          </p>
        )}
        {project.publishedAt && (
          <p
            className="mt-2 text-xs"
            style={{ color: "var(--text-secondary)" }}
          >
            Published {new Date(project.publishedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </Link>
  );
}

export type { ProjectSummary };
