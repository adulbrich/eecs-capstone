import { Link } from "@tanstack/react-router";
import { ImageIcon } from "lucide-react";
import { getPublicUrl } from "#/lib/storage";
import { cn } from "#/lib/utils.ts";
import { StatusBadge } from "./status-badge";

type ProjectSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  publishedAt: Date | string | null;
  imageUrl?: string | null;
};

function ImageOrFallback({
  src,
  className,
}: {
  src: string | null;
  className: string;
}) {
  if (src) {
    return <img src={src} alt="" className={className} loading="lazy" />;
  }
  return (
    <div
      className={cn(className, "flex items-center justify-center")}
      style={{
        background:
          "linear-gradient(135deg, var(--surface-sunken), var(--surface-base))",
      }}
    >
      <ImageIcon
        className="size-8 text-[var(--text-secondary)] opacity-30"
        aria-hidden
      />
    </div>
  );
}

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

export { ImageOrFallback };
export type { ProjectSummary };
