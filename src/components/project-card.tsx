import { Link } from "@tanstack/react-router";
import { StatusBadge } from "./status-badge";

type ProjectSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  publishedAt: Date | string | null;
};

export function ProjectCard({ project }: { project: ProjectSummary }) {
  return (
    <Link
      // @ts-expect-error route added in a later phase
      to="/projects/$projectId"
      // @ts-expect-error route added in a later phase
      params={{ projectId: project.id }}
      className="block border border-neutral-200 p-4 hover:bg-neutral-50 dark:border-neutral-800 dark:hover:bg-neutral-900"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{project.title}</h3>
        <StatusBadge status={project.status} />
      </div>
      {project.description && (
        <p className="mt-2 line-clamp-3 text-sm text-neutral-600">
          {project.description}
        </p>
      )}
      {project.publishedAt && (
        <p className="mt-2 text-xs text-neutral-500">
          Published {new Date(project.publishedAt).toLocaleDateString()}
        </p>
      )}
    </Link>
  );
}
