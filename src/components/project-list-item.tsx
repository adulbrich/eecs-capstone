import { ProjectCard, type ProjectSummary } from "./project-card";
import { ProjectRow } from "./project-row";

interface Props {
  mode: "card" | "row";
  project: ProjectSummary;
}

export function ProjectListItem({ project, mode }: Props) {
  if (mode === "row") {
    return <ProjectRow project={project} />;
  }
  return <ProjectCard project={project} />;
}
