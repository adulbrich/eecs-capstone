import { Link } from "@tanstack/react-router";
import { projectImageSrc } from "#/lib/project-image";
import { stripMarkdown } from "#/lib/strip-markdown";
import { ImageOrFallback } from "./image-or-fallback";
import { LocalTime } from "./local-time";
import { MentorshipBadges } from "./mentorship-badges";
import { StatusBadge } from "./status-badge";
import { Card } from "./ui/card";

interface ProjectSummary {
  contactName?: string | null;
  description: string | null;
  id: string;
  imageUrl?: string | null;
  programCourseId?: string | null;
  programCourseName?: string | null;
  seekingMentor?: boolean;
  status: string;
  studentProposed?: boolean;
  title: string;
  updatedAt?: Date | string | null;
}

function programLabel(project: ProjectSummary): string | null {
  const parts = [project.programCourseId, project.programCourseName].filter(
    Boolean
  ) as string[];
  return parts.length > 0 ? parts.join(" ") : null;
}

function ProjectMeta({ project }: { project: ProjectSummary }) {
  const meta = [programLabel(project), project.contactName].filter(
    Boolean
  ) as string[];
  return (
    <div className="mt-2">
      {meta.length > 0 && (
        <p className="text-muted-foreground text-xs">{meta.join(" · ")}</p>
      )}
      {project.updatedAt && (
        <p className="mt-0.5 text-muted-foreground text-xs">
          Updated <LocalTime dateOnly value={project.updatedAt} />
        </p>
      )}
    </div>
  );
}

export function ProjectCard({ project }: { project: ProjectSummary }) {
  const src = projectImageSrc(project.imageUrl);
  return (
    <Card asChild className="flex flex-col overflow-hidden" interactive>
      <Link params={{ projectId: project.id }} to="/projects/$projectId">
        <ImageOrFallback
          className="aspect-[16/9] w-full object-cover"
          src={src}
        />
        <div className="flex flex-1 flex-col p-4">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold leading-tight">{project.title}</h3>
            {project.status !== "published" && (
              <StatusBadge status={project.status} />
            )}
          </div>
          <MentorshipBadges
            className="mt-2"
            seekingMentor={project.seekingMentor ?? false}
            studentProposed={project.studentProposed ?? false}
          />
          {project.description && (
            <p className="mt-2 line-clamp-3 text-muted-foreground text-sm">
              {stripMarkdown(project.description)}
            </p>
          )}
          <ProjectMeta project={project} />
        </div>
      </Link>
    </Card>
  );
}

export type { ProjectSummary };
export { ProjectMeta, programLabel };
