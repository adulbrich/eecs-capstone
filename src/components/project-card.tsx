import { Link } from "@tanstack/react-router";
import { projectImageSrc } from "#/lib/project-image";
import { stripMarkdown } from "#/lib/strip-markdown";
import { ApplicantsBadge } from "./applicants-badge";
import { BookmarkToggle } from "./bookmark-set";
import { ImageOrFallback } from "./image-or-fallback";
import { LocalTime } from "./local-time";
import { MentorshipBadges } from "./mentorship-badges";
import { StatusBadge } from "./status-badge";
import { Card } from "./ui/card";

interface ProjectSummary {
  acceptingApplicants: boolean;
  contactName?: string | null;
  description: string | null;
  id: string;
  imageUrl?: string | null;
  programCourseId?: string | null;
  programCourseName?: string | null;
  seekingMentor: boolean;
  status: string;
  studentProposed: boolean;
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
    <div className="mt-2 md:mt-1">
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

/**
 * One project in a listing, at both widths: image on top below `md`, image
 * on the left from `md` up. Two components used to render these shapes and
 * the mode picked between them, so a phone in row mode got a thumbnail beside
 * a truncated title; now the viewport picks.
 *
 * The `Card` is not `asChild` around the `Link`: the bookmark control is a
 * button, a button inside an anchor is invalid HTML and a nested interactive
 * to axe, so the link and the control are siblings. The control renders
 * nothing outside a `BookmarkSetProvider`, and its wrapper hides itself then.
 */
export function ProjectCard({ project }: { project: ProjectSummary }) {
  const src = projectImageSrc(project.imageUrl);
  return (
    <Card
      className="flex flex-col overflow-hidden md:flex-row md:items-center md:gap-3 md:p-3"
      interactive
    >
      <Link
        className="flex min-w-0 flex-1 flex-col md:flex-row md:items-center md:gap-3"
        params={{ projectId: project.id }}
        to="/projects/$projectId"
      >
        <ImageOrFallback
          className="aspect-[16/9] w-full object-cover md:aspect-[3/2] md:w-40 md:shrink-0 md:rounded-md"
          src={src}
        />
        <div className="flex min-w-0 flex-1 flex-col p-4 md:p-0">
          <div className="flex items-start justify-between gap-3">
            <h3 className="font-semibold leading-tight">{project.title}</h3>
            {project.status !== "published" && (
              <StatusBadge status={project.status} />
            )}
          </div>
          <MentorshipBadges
            className="mt-2"
            seekingMentor={project.seekingMentor}
            studentProposed={project.studentProposed}
          />
          <ApplicantsBadge
            acceptingApplicants={project.acceptingApplicants}
            className="mt-2"
          />
          {project.description && (
            <p className="mt-2 line-clamp-3 text-muted-foreground text-sm md:mt-1">
              {stripMarkdown(project.description)}
            </p>
          )}
          <ProjectMeta project={project} />
        </div>
      </Link>
      <div className="px-4 pb-4 empty:hidden md:shrink-0 md:px-0 md:pb-0">
        <BookmarkToggle projectId={project.id} />
      </div>
    </Card>
  );
}

export type { ProjectSummary };
export { programLabel };
