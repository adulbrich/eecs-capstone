import { Link } from "@tanstack/react-router";
import { getPublicUrl } from "#/lib/storage";
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
      className={`${className} bg-gradient-to-br from-neutral-200 to-neutral-300 dark:from-neutral-800 dark:to-neutral-900`}
    />
  );
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const src = getPublicUrl(project.imageUrl);
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      className="block overflow-hidden border border-neutral-200 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
    >
      <ImageOrFallback
        src={src}
        className="aspect-[16/9] w-full object-cover"
      />
      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-semibold">{project.title}</h3>
          <StatusBadge status={project.status} />
        </div>
        {project.description && (
          <p className="mt-2 line-clamp-2 text-sm text-neutral-600">
            {project.description}
          </p>
        )}
        {project.publishedAt && (
          <p className="mt-2 text-xs text-neutral-500">
            Published {new Date(project.publishedAt).toLocaleDateString()}
          </p>
        )}
      </div>
    </Link>
  );
}

export { ImageOrFallback };
export type { ProjectSummary };
